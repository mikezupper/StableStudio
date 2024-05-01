import * as StableStudio from "@stability/stablestudio-plugin";
import { StableDiffusionImage, StableDiffusionImages } from "@stability/stablestudio-plugin";

import {
  constructPayload,
  fetchOptions,
  db,
  webuiModels,
  webuiUpscalers,
  IGeneratedImage,
} from "./Utilities";

const manifest = {
  name: "Livepeer AI Plugin",
  author: "Livepeer.Cloud SPE",
  icon: `${window.location.origin}/logo.png`,
  link: "https://github.com/mikezupper/StableStudio",
  version: "0.0.0",
  license: "MIT",
  description:
    "This plugin uses [`Livepeer.Cloud Gateway`](https://www.livepeer.cloud) as its back-end for inference",
};

const getNumber = (strValue: string | null, defaultValue: number) => {
  let retValue = defaultValue;

  if (strValue) {
    retValue = Number(strValue);
  }

  return retValue;
};

const getStableDiffusionDefaultCount = () => 4;
export const createPlugin = StableStudio.createPlugin<{
  settings: {
    baseUrl: StableStudio.PluginSettingString;
    upscaler: StableStudio.PluginSettingString;
    historyImagesCount: StableStudio.PluginSettingNumber;
  };
}>(({ set, get }) => {
  const webuiLoad = (
    webuiHostUrl?: string
  ): Pick<
    StableStudio.Plugin,
    | "createStableDiffusionImages"
    | "getStatus"
    | "getStableDiffusionModels"
    | "getStableDiffusionSamplers"
    | "getStableDiffusionDefaultCount"
    | "getStableDiffusionDefaultInput"
    | "getStableDiffusionExistingImages"
  > => {
    return {
      createStableDiffusionImages: async (options) => {
        if (!options) {
          throw new Error("options is required");
        }

        // fetch the current webui options (model/sampler/etc)
        const webUIOptions = await fetchOptions(webuiHostUrl);

        const { model, sampler, initialImage } = options?.input ?? {};
        options.count = options?.count ?? getStableDiffusionDefaultCount();

        // quickly save the sampler and model name to local storage
        if (sampler?.name) {
          localStorage.setItem("webui-saved-sampler", sampler.name);
        }

        if (model) {
          localStorage.setItem("webui-saved-model", model);
        }

        // little hacky until StableStudio is better with upscaling
        const isUpscale =
          options?.input?.initialImage?.weight === 1 &&
          model === "esrgan-v1-x2plus";

        // WebUI doesn't have the right model loaded, switch the model
        if (model && model !== webUIOptions.sd_model_checkpoint && !isUpscale) {
          localStorage.setItem("webui-saved-model", model);
        }

        // Construct payload for webui
        const data = await constructPayload(
          options,
          isUpscale,
          get().settings.upscaler.value
        );

        const fetchGeneratedImage = async (img_path: string) => {
          let new_url = `${webuiHostUrl}${img_path}`;

          const response = await fetch(new_url);
          return await response.blob();
        };

        const postJson = async (uri: string, body: string) => {
          return await fetch(uri, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });
        };

        const processImg2ImgRequest = async () => {
          console.log("processImg2ImgRequest");

          const formData = new FormData();
          formData.append("model_id", `${data.model_id}`);
          formData.append("width", `${data.width}`);
          formData.append("height", `${data.height}`);
          formData.append(
            "num_images_per_prompt",
            `${data.num_images_per_prompt}`
          );
          formData.append("negative_prompt", `${data.negative_prompt}`);
          formData.append("prompt", `${data.prompt}`);
          formData.append("motion_bucket_id", "50");
          formData.append("noise_aug_strength", `${data.denoising_strength}`);
          formData.append("image", data.init_images[0]);
          return await fetch(`${webuiHostUrl}/image-to-image`, {
            method: "POST",
            mode: "cors",
            cache: "no-cache",
            body: formData,
          });
        };

        const processText2ImgRequest = async () => {
          console.log("processText2ImgRequest");
          return postJson(`${webuiHostUrl}/text-to-image`, data);
        };

        const processUpscaleImgRequest = async () => {
          console.log("processUpscaleImgRequest");
          return postJson(`${webuiHostUrl}/upscale-image`, data);
        };

        // Send payload to webui
        const fetch_fn = initialImage
          ? isUpscale
            ? processUpscaleImgRequest
            : processImg2ImgRequest
          : processText2ImgRequest;

        const response = await fetch_fn();

        const responseData = await response.json();

        const images = [];
        const createdAt = new Date();

        if (isUpscale) {
          // Upscaling only returns one image
          let img = responseData.images[0];
          let seed = img.seed;
          console.log("createStableDiffusionImages upscale img ", img);

          let blob = await fetchGeneratedImage(img.url);

          const image = {
            id: `${crypto.randomUUID()}`,
            createdAt: createdAt,
            blob: blob,
            input: {
              prompts: options?.input?.prompts ?? [],
              num_images_per_prompt: options?.count,
              num_inference_steps: options?.input?.steps ?? 0,
              seed,
              model_id: model ?? "",
              width: options?.input?.width ?? 1024,
              height: options?.input?.height ?? 1024,
              guidance_scale: options?.input?.cfgScale ?? 7,
            },
          };

          images.push(image);
        } else {
          // Image generation returns an array of images
          console.log("images returned ", responseData?.images);
          if (responseData.images && responseData.images.length > 0) {
            for (let i = 0; i < responseData.images.length; i++) {
              let img = responseData.images[i];
              let seed = img.seed;
              console.log("createStableDiffusionImages img ", img);

              let blob = await fetchGeneratedImage(img.url);

              const image = {
                id: `${crypto.randomUUID()}`,
                createdAt,
                blob,
                input: {
                  prompts: options?.input?.prompts ?? [],
                  num_images_per_prompt: options?.count,
                  num_inference_steps: options?.input?.steps ?? 0,
                  seed,
                  model_id: model ?? "",
                  width: options?.input?.width ?? 1024,
                  height: options?.input?.height ?? 1024,
                  guidance_scale: options?.input?.cfgScale ?? 7,
                  // sampler: sampler ?? { id: "", name: "" },
                },
              };

              images.push(image);
            }
          } else {
            console.log("no image returned from request.....");
          }
        }
        let existing_response: IGeneratedImage = {
          id: `${crypto.randomUUID()}`,
          images,
        };
        await db.responses.add(existing_response);
        return existing_response;
      },

      getStableDiffusionModels: async () => {
        return webuiModels;
      },

      getStatus: async () => {
        let images = await db.responses.toArray();
        const hasWebuiHistoryPlugin = images !== undefined;
        return {
          indicator: hasWebuiHistoryPlugin ? "success" : "info",
          text: `Ready ${
            hasWebuiHistoryPlugin ? "with" : "without"
          } history plugin`,
        };
      },
    };
  };

  let webuiHostUrl = localStorage.getItem("webui-host-url");

  if (!webuiHostUrl || webuiHostUrl === "") {
    webuiHostUrl = "https://dream-gateway.livepeer.cloud";
  }

  return {
    ...webuiLoad(webuiHostUrl),

    getStableDiffusionDefaultCount: () => 4,

    getStableDiffusionDefaultInput: () => {
      return {
        width: 1024,
        height: 1024,
        model_id: localStorage.getItem("webui-saved-model") ?? webuiModels[0].name,
        model: undefined,
      };
    },

    getStableDiffusionSamplers: async () => {
      return [
        { id: "0", name: "DDIM" },
        { id: "1", name: "DDPM" },
        { id: "2", name: "K Euler" },
        { id: "3", name: "K Euler Ancestral" },
        { id: "4", name: "K Heun" },
        { id: "5", name: "K DPM 2" },
        { id: "6", name: "K DPM 2 Ancestral" },
        { id: "7", name: "K LMS" },
        { id: "8", name: "K DPM++ 2S Ancestral" },
        { id: "9", name: "K DPM++ 2M" },
        { id: "10", name: "K DPM++ SDE" },
      ];
    },

    getStableDiffusionExistingImages: async () => {
      //TODO: need to prune/limit the number of images stored in history....
      console.log(
        "getStableDiffusionExistingImages limit:",
        get().settings.historyImagesCount.value
      );
      let images = await db.responses.toArray();
      if (images.length == 0) return undefined;
      let images_response: StableDiffusionImages[] = [
        {
          id: `${crypto.randomUUID()}`,
          images: images.map((i) => {
            let x: StableDiffusionImage = {
              ...i,
            };
            return x;
          }),
        },
      ];
      return images_response;
    },

    settings: {
      baseUrl: {
        type: "string",
        title: "Livepeer.Cloud Gateway",
        placeholder: "https://dream-gateway.livepeer.cloud",
        value: localStorage.getItem("webui-host-url") ?? "https://dream-gateway.livepeer.cloud",
        description:
          "The URL of the `Livepeer.Cloud Gateway` host, usually https://dream-gateway.livepeer.cloud",
      },

      upscaler: {
        type: "string",
        title: "Upscaler 1",
        options: webuiUpscalers,
        value: localStorage.getItem("upscaler1") ?? webuiUpscalers[0].value,
        description:
          "Select the upscaler used when downloading images at more than 1x size",
      },

      historyImagesCount: {
        type: "number",
        title: "History image count",
        description: "How many images should be fetched from local history?",
        min: 0,
        max: 50,
        step: 1,
        variant: "slider",
        value: getNumber(localStorage.getItem("historyImagesCount"), 20),
      },
    },

    setSetting: (key, value) => {
      set(({ settings }) => ({
        settings: {
          ...settings,
          [key]: { ...settings[key], value: value as string },
        },
      }));

      if (key === "baseUrl" && typeof value === "string") {
        localStorage.setItem("webui-host-url", value);
        set((plugin) => ({ ...plugin, ...webuiLoad(value) }));
      } else if (key === "upscaler" && typeof value === "string") {
        localStorage.setItem("upscaler1", value);
      } else if (key === "historyImagesCount" && typeof value === "number") {
        localStorage.setItem("historyImagesCount", value.toString());
      }
    },

    manifest,
  };
});