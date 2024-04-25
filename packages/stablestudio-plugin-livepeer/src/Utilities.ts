import Dexie from "dexie";
import { StableDiffusionInput,StableDiffusionImage } from "@stability/stablestudio-plugin";

export function base64ToBlob(base64: string, contentType = ""): Promise<Blob> {
  return fetch(`data:${contentType};base64,${base64}`).then((res) =>
    res.blob()
  );
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;

    reader.readAsDataURL(blob);
  });
}

export async function fetchOptions(baseUrl: string | undefined) {
  //TODO: what options need fetching?
  return {
    sd_model_checkpoint: webuiModels[0].name,
    ok: undefined
  };
}

export async function setOptions(baseUrl: string | undefined, options: any) {
  //TODO: what options need to be returned????

  return {
    sd_model_checkpoint: undefined,
    ok: undefined
  };
}

export async function getImageInfo(
  baseUrl: string | null,
  base64image: any
) {
  const imageInfoResponse = await fetch(`${baseUrl}/sdapi/v1/png-info`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ image: base64image }),
  });

  const imageInfoJson = await imageInfoResponse.json();

  const info = imageInfoJson.info.split("\n");

  const data: any = {};

  if (info.length === 0) {
    return data;
  }

  data.prompt = info[0];

  let detailIndex = 1;

  if (info.length === 3) {
    data.nagtivePrompt = info[1].split(":")[1].trim();

    detailIndex = 2;
  }

  const details = info[detailIndex].split(",");

  details.map((detail: any) => {
    const detailInfo = detail.trim().split(":");

    data[detailInfo[0]] = detailInfo[1].trim();
  });

  return data;
}

export async function testForHistoryPlugin(webuiHostUrl: string) {
  // timeout after 1 second
  const finished = Promise.race([
    fetch(`${webuiHostUrl}/StableStudio/get-generated-images`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        limit: 1,
      }),
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), 1000)
    ),
  ]);

  try {
    await finished;
    return (finished as any).ok;
  } catch (error) {
    return false;
  }
}

export async function constructPayload(
  options: {
    input?: StableDiffusionInput | undefined;
    count?: number | undefined;
  },
  isUpscale = false,
  upscaler: string | undefined
) {
  console.log("constructPayload incoming option ",options);
  const { sampler, prompts, initialImage, maskImage, width, height, steps,model } =
    options?.input ?? {};
  let model_id = model? model: webuiModels[0].name;

  // Construct payload
  const data: any = {
    seed: options?.input?.seed === 0 ? undefined : options?.input?.seed,
    guidance_scale: options?.input?.cfgScale ?? 7,
  };

  if (isUpscale) {
    /*
      Upscaling values
    */

    data.upscaling_resize_w = width ?? 512;
    data.upscaling_resize_h = height ?? 512;
    data.upscaler_1 = upscaler;
  } else {
    /*
      regular image generation values
    */

    data.width = width ?? 1024;
    data.height = height ?? 1024;

    data.sampler_name = sampler?.name ?? "";
    data.sampler_index = sampler?.name ?? "";

    data.prompt =
      prompts?.find((p) => (p.text && (p.weight ?? 0) > 0) ?? 0 > 0)?.text ??
      "";
    data.negative_prompt =
      prompts?.find((p) => (p.text && (p.weight ?? 0) < 0) ?? 0 < 0)?.text ??
      "";

    data.num_inference_steps = steps ?? 20;
    data.num_images_per_prompt = options?.count;
    data.model_id = model_id;
  }

  if (initialImage?.weight && !isUpscale) {
    data.denoising_strength = 1 - initialImage.weight;
  }

  if (initialImage?.blob) {
    const initImgB64 = initialImage?.blob;

    if (isUpscale) {
      data.image = initImgB64;
    } else {
      data.init_images = [initImgB64];
    }
  }

  if (maskImage?.blob) {
    const maskImgB64 =maskImage?.blob;
    data.mask = maskImgB64;

    data.inpainting_mask_invert = 1; // Mask mode
    data.inpainting_fill = 1; // Masked content
    data.inpaint_full_res = false; // Inpaint area
  }

  return data;
}

class LivepeerCloudStudioDB extends Dexie {
  responses!: Dexie.Table<IGeneratedImage, number>;

  constructor() {
    super("LivepeerCloudStudio");
    this.version(3).stores({
      responses: "id,images",
    });
  }
}

export interface IGeneratedImage {
  id: string;
  images: StableDiffusionImage[];
}

export const db = new LivepeerCloudStudioDB();

export const webuiUpscalers = [
  {
    label: "None",
    value: "None",
  },
  {
    label: "Lanczos",
    value: "Lanczos",
  },
  {
    label: "Nearest",
    value: "Nearest",
  },
  {
    label: "ESRGAN_4x",
    value: "ESRGAN_4x",
  },
  {
    label: "LDSR",
    value: "LDSR",
  },
  {
    label: "R-ESRGAN 4x+",
    value: "R-ESRGAN 4x+",
  },
  {
    label: "R-ESRGAN 4x+ Anime6B",
    value: "R-ESRGAN 4x+ Anime6B",
  },
  {
    label: "ScuNET GAN",
    value: "ScuNET GAN",
  },
  {
    label: "ScuNET PSNR",
    value: "ScuNET PSNR",
  },
  {
    label: "SwinIR_4x",
    value: "SwinIR_4x",
  },
];

export const webuiModels = [
  { id: "ByteDance/SDXL-Lightning", name: "ByteDance/SDXL-Lightning" },
  { id: "SG161222/RealVisXL_V4.0_Lightning", name: "SG161222/RealVisXL_V4.0_Lightning" }
];