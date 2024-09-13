import sys
import logging
from PIL import Image, ImageDraw, ImageFont
import textwrap
import numpy as np

# Set up logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')

def create_stroke_mask(image, stroke_width):
    """Create a stroke mask using numpy operations."""
    np_image = np.array(image)
    stroke = np.zeros_like(np_image)
    
    for i in range(-stroke_width, stroke_width + 1):
        for j in range(-stroke_width, stroke_width + 1):
            if i*i + j*j <= stroke_width*stroke_width:
                rolled = np.roll(np_image, (i, j), axis=(0, 1))
                stroke = np.maximum(stroke, rolled)
    
    return Image.fromarray(stroke)

def generate_caption(input_path, output_path, caption_text, font_size, font_color, stroke_color, stroke_width, font_name, font_weight):
    try:
        logging.info(f"Opening image: {input_path}")
        img = Image.open(input_path).convert("RGBA")
        
        # Create a high-resolution canvas
        scale_factor = 4  # Increase this for even higher resolution
        canvas_width = img.width * scale_factor
        canvas_height = img.height * scale_factor
        canvas = Image.new("RGBA", (canvas_width, canvas_height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(canvas)
        
        # Convert font_size to integer
        font_size = int(font_size)
        
        logging.info(f"Loading font: {font_name}, size: {font_size}")
        try:
            font = ImageFont.truetype(font_name, font_size * scale_factor)
        except IOError as font_error:
            logging.warning(f"Font {font_name} not found. Using default font. Error: {font_error}")
            font = ImageFont.load_default().font_variant(size=font_size * scale_factor)
        
        # Calculate text size
        bbox = draw.textbbox((0, 0), caption_text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        
        # Position the text at the bottom center of the image
        x = (canvas_width - text_width) / 2
        y = canvas_height - text_height - (20 * scale_factor)  # 20 pixels from bottom
        
        logging.info("Drawing high-resolution text with stroke")
        
        # Create a mask for the text
        mask = Image.new('L', (canvas_width, canvas_height), 0)
        mask_draw = ImageDraw.Draw(mask)

        # Draw text on the mask
        mask_draw.text((x, y), caption_text, font=font, fill=255)

        # Create the stroke using the custom function
        stroke_size = max(1, int(float(stroke_width) * scale_factor))
        logging.info(f"Creating stroke with size: {stroke_size}")
        stroke_mask = create_stroke_mask(mask, stroke_size)
        
        # Draw the stroke
        stroke_layer = Image.new("RGBA", (canvas_width, canvas_height), stroke_color)
        canvas.paste(stroke_layer, (0, 0), stroke_mask)

        # Draw the original text
        draw.text((x, y), caption_text, font=font, fill=font_color)
        
        # Scale down the high-resolution canvas
        canvas = canvas.resize((img.width, img.height), Image.LANCZOS)
        
        # Paste the scaled canvas onto the original image
        img = Image.alpha_composite(img, canvas)
        
        logging.info(f"Saving image: {output_path}")
        img.save(output_path)
        logging.info("High-resolution caption generated successfully")
    except Exception as e:
        logging.exception(f"Error generating caption: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 10:
        logging.error("Incorrect number of arguments")
        sys.exit(1)

    input_path, output_path, caption_text, font_size, font_color, stroke_color, stroke_width, font_name, font_weight = sys.argv[1:]
    
    logging.info(f"Arguments: {sys.argv[1:]}")
    generate_caption(input_path, output_path, caption_text, font_size, font_color, stroke_color, stroke_width, font_name, font_weight)