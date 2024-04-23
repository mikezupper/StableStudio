import * as StableStudio from "@stability/stablestudio-plugin";
import Dexie from "dexie";

let supported_models: Array<StableStudio.StableDiffusionModel> = new Array();
supported_models.push({ id: "0", name: "ByteDance/SDXL-Lightning" });
supported_models.push({ id: "1", name: "SG161222/RealVisXL_V4.0_Lightning" });

let supported_samplers: Array<StableStudio.StableDiffusionSampler> =
  new Array();
supported_samplers.push({ id: "0", name: "DPM++2MSDE" });
supported_samplers.push({ id: "1", name: "DPMSolverMultistep" });
supported_samplers.push({ id: "2", name: "KarrasDPM" });
supported_samplers.push({ id: "3", name: "K_EULER_ANCESTRAL" });
supported_samplers.push({ id: "4", name: "K_EULER" });
supported_samplers.push({ id: "5", name: "PNDM" });
supported_samplers.push({ id: "6", name: "DDIM" });
supported_samplers.push({ id: "7", name: "HeunDiscrete" });

export class LivepeerCloudStudioDB extends Dexie {
  responses!: Dexie.Table<IGeneratedImage, number>;

  constructor() {
    super("LivepeerCloudStudio");
    this.version(2).stores({
      responses: "id,images",
    });
  }
}

export interface IGeneratedImage {
  id: string;
  images: StableStudio.StableDiffusionImage[];
}

var db = new LivepeerCloudStudioDB();

const getStableDiffusionDefaultCount = () => 1;
const getStableDiffusionDefaultInputFromPrompt = (prompt: string) => ({
  prompt,
  width: 512,
  height: 512,
  cfgScale: 7,
  steps: 50,
  negative_prompt: "",
  model: "0",
});
const getStableDiffusionDefaultInput = () => ({
  prompt,
  width: 512,
  height: 512,
  cfgScale: 7,
  steps: 50,
  negative_prompt: "",
  model: "0",
  samples: 1,
});

export const createPlugin = StableStudio.createPlugin<{
  imagesGeneratedSoFar: number;
  settings: {
    gatewayUrl: StableStudio.PluginSettingString;
  };
}>(({ context, set, get }) => {
  return {
    imagesGeneratedSoFar: 0,

    manifest: {
      name: "Livepeer AI Plugin",
      author: "Livepeer.Cloud SPE",
      link: "https://www.livepeer.cloud",
      icon: `${window.location.origin}/logo.png`,
      version: "0.0.1",
      license: "MIT",
      description: "A Livepeer AI Powered Plugin",
    },
    getStableDiffusionDefaultInput,
    getStableDiffusionSamplers: () => {
      return supported_samplers;
    },
    getStableDiffusionModels: () => {
      return supported_models;
    },
    getStableDiffusionExistingImages: async (options) => {
      let responses = await db.responses.toArray();

      if (responses.length == 0) return undefined;

      return responses;
    },
    createStableDiffusionImages: async (options) => {
      console.log("[createStableDiffusionImages] options", options);
      const count = options?.count ?? getStableDiffusionDefaultCount();
      const defaultStableDiffusionInput =
        getStableDiffusionDefaultInputFromPrompt(
          context.getStableDiffusionRandomPrompt()
        );

      const input = {
        ...defaultStableDiffusionInput,
        ...options?.input,
      };

      const width = input.width ?? defaultStableDiffusionInput.width;
      const height = input.height ?? defaultStableDiffusionInput.height;

      // add init and mask
      if (input.maskImage?.blob) {
        console.log("input has a maskImage");
      }

      const num_inference_steps =
        input?.steps ?? defaultStableDiffusionInput.steps;

      const guidance_scale =
        input?.cfgScale ?? defaultStableDiffusionInput.cfgScale;

      //MY CODE START
      let gatewayUrl = localStorage.getItem("livepeer-gatewayUrl") ?? undefined;
      console.log("gatewayUrl", gatewayUrl);

      const num_images_per_prompt =
        options?.count ?? getStableDiffusionDefaultCount();

      let prompts = input?.prompts ? input?.prompts : [];
      let prompt = prompts[0].text;
      let negative_prompt: string | undefined = "";

      if (prompts.length == 2) negative_prompt = prompts[1].text;

      let model_name = supported_models.filter(
        (model) => model.id == input.model
      )[0].name;

      const fetchGeneratedImage = async (img_path: string) => {
        let new_url = `${gatewayUrl}/ai-out/${img_path}`;

        const response = await fetch(new_url);
        return await response.blob();
      };

      let id = `${crypto.randomUUID()}`;

      const processImg2ImgRequest = async (
        image_blob: Blob,
        image_weight: number | undefined
      ) => {
        const formData = new FormData();
        formData.append("model_id", `${model_name}`);
        formData.append("width", `${width}`);
        formData.append("height", `${height}`);
        formData.append("num_images_per_prompt", `${num_images_per_prompt}`);
        formData.append("negative_prompt", `${negative_prompt}`);
        formData.append("prompt", `${prompt}`);
        formData.append("motion_bucket_id", "50");
        formData.append(
          "noise_aug_strength",
          `${image_weight ? image_weight : 0.05}`
        );
        formData.append("image", image_blob);
        let output_data = await fetch(`${gatewayUrl}/image-to-image`, {
          method: "POST",
          mode: "cors",
          cache: "no-cache",
          body: formData,
        });
        let output_json = await output_data.json();
        console.log("[processImg2ImgRequest] output json ", output_json);
        const images: StableStudio.StableDiffusionImage[] = [];

        for (let index = 0; index < output_json.images.length; index++) {
          let img = output_json.images[index];
          // let img = output_json.images[0];
          let seed = img.seed;
          let blob = await fetchGeneratedImage(img.url);
          const createdAt = new Date();
          let new_img = {
            input: {
              ...input,
              seed,
            },
            id: `${crypto.randomUUID()}`,
            createdAt,
            blob,
          };
          images.push(new_img);
        }
        let resp: IGeneratedImage = { id, images };
        return resp;
      };

      const processText2ImgRequest = async () => {
        let body = {
          prompt,
          negative_prompt,
          height,
          width,
          // samples: num_images_per_prompt,
          num_images_per_prompt: num_images_per_prompt,
          num_inference_steps,
          guidance_scale,
          scheduler: "K_EULER",
          model_id: model_name,
        };
        console.log("body sent to gateway: ", body);

        let output_data = await fetch(`${gatewayUrl}/text-to-image`, {
          method: "POST",
          mode: "cors",
          cache: "no-cache",
          body: JSON.stringify(body),
          headers: {
            "Content-Type": "application/json",
          },
        });

        let output_json = await output_data.json();
        console.log("output from gateway: ", output_json);
        const images: StableStudio.StableDiffusionImage[] = [];

        for (let index = 0; index < output_json.images.length; index++) {
          let img = output_json.images[index];
          let seed = img.seed;
          let blob = await fetchGeneratedImage(img.url);
          const createdAt = new Date();
          let new_img = {
            input: {
              ...input,
              seed,
            },
            id: `${crypto.randomUUID()}`,
            createdAt,
            blob,
          };
          images.push(new_img);
        }
        let resp: IGeneratedImage = { id, images };
        return resp;
      };

      let existing_response: IGeneratedImage = { id, images: [] };
      if (input.initialImage?.blob) {
        console.log("input has a initialImage");
        existing_response = await processImg2ImgRequest(
          input.initialImage?.blob,
          input.initialImage?.weight
        );
      } else {
        existing_response = await processText2ImgRequest();
      }
      await db.responses.add(existing_response);
      return existing_response;
    },

    getStatus: () => {
      const { imagesGeneratedSoFar } = get();
      return {
        indicator: "success",
        text:
          imagesGeneratedSoFar > 0
            ? `${imagesGeneratedSoFar} images generated`
            : "Ready",
      };
    },

    settings: {
      gatewayUrl: {
        type: "string" as const,
        default: "https://dream-gateway.livepeer.cloud",
        title: "Your Livepeer AI Gateway URL",
        placeholder: "https://dream-gateway.livepeer.cloud",
        required: true,

        value:
          localStorage.getItem("livepeer-gatewayUrl") ??
          "https://dream-gateway.livepeer.cloud",
      },
    },

    setSetting: (key, value) =>
      set(({ settings }) => {
        if (key === "gatewayUrl" && typeof value === "string") {
          localStorage.setItem("livepeer-gatewayUrl", value);
          //  set((plugin) => ({ ...plugin, ...functionsWhichNeedAPIKey(value) }));
        }

        return {
          settings: {
            [key]: { ...settings[key], value: value as string },
          },
        };
      }),
  };
});
