import torch
from diffusers import StableDiffusionPipeline, DiffusionPipeline, FluxPipeline
from diffusers.models import FluxTransformer2DModel
import argparse
from tqdm import tqdm
import os
import shutil
from torchvision import transforms
from huggingface_hub import login
login(token="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")

def generate_flower_image(output_file, aspect_ratio, prompt, negativePrompt, width, height, base_model, lora_model, root_folder):
    if torch.backends.mps.is_available():
        device = torch.device("mps")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
    else:
        device = torch.device("cpu")

    # Use the rootFolder to construct paths
    base_model_path = os.path.join(root_folder, "Models", "Base-Models", base_model)
    
    # Load the base model
    # if "flux" in base_model.lower():
    #     transformer = FluxTransformer2DModel.from_single_file(
    #         base_model_path,
    #         use_safetensors=True,
    #         torch_dtype=torch.float16,
    #         variant="fp16"
    #     )
    #     pipe = FluxPipeline.from_pretrained(
    #         "black-forest-labs/FLUX.1-dev",
    #         transformer=transformer,
    #         torch_dtype=torch.float16
    #     )
    # else:
    print("BASE", base_model_path)
    pipe = StableDiffusionPipeline.from_single_file(
        base_model_path,
        use_safetensors=True,
        torch_dtype=torch.float16,
        variant="fp16"
    )
    print("BASE", base_model_path)

    # Load the LoRA model if specified
    if lora_model:
        lora_path = os.path.join(root_folder, "Models", "LoRA", lora_model)
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

    # Use the callback_on_step_end or callback_steps in the pipeline call
    image = pipe(
        prompt=prompt,
        negative_prompt=negativePrompt,
        generator=generator,
        guidance_scale=7,
        num_inference_steps=num_inference_steps,
        height=height,
        width=width,
        callback=callback,
        callback_steps=1,
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
    parser.add_argument("base_model", type=str, help="Base model to use")
    parser.add_argument("lora_model", type=str, help="LoRA model to use")
    parser.add_argument("root_folder", type=str, help="Root folder path")

    args = parser.parse_args()

    generate_flower_image(args.output_file, args.aspect_ratio, args.prompt, args.negativePrompt, 
                          args.width, args.height, args.base_model, args.lora_model, args.root_folder)
