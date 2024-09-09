import torch
from diffusers import StableDiffusionPipeline, DiffusionPipeline
import argparse
from tqdm import tqdm
import os
import shutil
from torchvision import transforms

def generate_flower_image(output_file, aspect_ratio, prompt, negativePrompt, width, height, base_model):
    cache_dir = "./model_cache"

    if torch.backends.mps.is_available():
        device = torch.device("mps")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
    else:
        device = torch.device("cpu")

    # Determine which base model and LoRa to use
    if base_model == "sd1.5":
        pipe = StableDiffusionPipeline.from_single_file(
            "./anyloraCheckpoint_bakedvaeBlessedFp16.safetensors",
            use_safetensors=True,
            # torch_dtype=torch.float32,
            torch_dtype=torch.float16,

            variant="fp16"
        )
        #lora_path = "./LoRa/EPTakeuchiNaokoStyle-03.safetensors"

        lora_path = "./LoRa/ghibli_style_offset.safetensors"
    elif base_model == "sdxl":
        pipe = DiffusionPipeline.from_pretrained("stabilityai/stable-diffusion-xl-base-1.0", 
                                                 torch_dtype=torch.float16, 
                                                 cache_dir=cache_dir)
        lora_path = "./LoRa/araminta_k_phantasma_anime.safetensors"
    else:
        raise ValueError(f"Unsupported base model: {base_model}")

    # Load the LoRa model
    pipe.load_lora_weights(lora_path)


    pipe.to(device)


    # If using MPS (Metal), we need to use a different generator
    if device.type == "mps":
        generator = torch.Generator()
    else:
        generator = torch.Generator(device)

    num_inference_steps = 20
    progress_bar = tqdm(total=num_inference_steps, desc="Generating Image")

    def callback(step: int, *args, **kwargs):
        progress_bar.update(1)
        print(f"PROGRESS: {step}/{num_inference_steps}")

    # Use the callback_on_step_end or callback_steps in the pipeline call
    image = pipe(
        prompt=prompt,
        negative_prompt=negativePrompt,
        generator=generator,
        guidance_scale=7,
        num_inference_steps=num_inference_steps,
        height=height,
        width=width,
        callback=callback,  # using the updated callback
        callback_steps=1,   # update every step
    ).images[0]

    image_tensor = transforms.ToTensor()(image)

    # Now check for NaN values
    if torch.isnan(image_tensor).any():
        print("NaN values detected in the generated image.")

    progress_bar.close()
    image.save(output_file)
    print(f"Saved flower image to {output_file}")

    raw_output_file = os.path.splitext(output_file)[0] + "_raw.png"
    image.save(raw_output_file)
    print(f"Saved raw flower image to {raw_output_file}")


    # Check if the generated image is 2.png and update the thumbnail if it is
    if os.path.basename(output_file) == "2.png":
        project_dir = os.path.dirname(os.path.dirname(output_file))
        thumbnail_path = os.path.join(project_dir, "thumbnail.png")
        shutil.copy(output_file, thumbnail_path)
        print(f"Updated project thumbnail with 2.png")
    

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate a flower image using Stable Diffusion.")
    parser.add_argument("output_file", type=str, help="The path where the generated image will be saved.")
    parser.add_argument("aspect_ratio", type=float, help="The aspect ratio (width/height) of the generated image.")
    parser.add_argument("prompt", type=str, help="gen image")
    parser.add_argument("negativePrompt", type=str, help="gen image")
    parser.add_argument("width", type=float, help="width")
    parser.add_argument("height", type=float, help="height")
    parser.add_argument("base_model", type=str, choices=["sd1.5", "sdxl"], help="Base model to use")

    args = parser.parse_args()

    generate_flower_image(args.output_file, args.aspect_ratio, args.prompt, args.negativePrompt, 
                          args.width, args.height, args.base_model)
