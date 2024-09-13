import os
import ffmpeg
import subprocess
import sys



def renderProject(projectFolder, output_file):
    # Paths to the relevant folders
    image_folder = os.path.join(projectFolder, 'Images')
    clip_folder = os.path.join(projectFolder, 'Clips')

    # Check if the image folder exists
    if not os.path.exists(image_folder):
        print(f"Image folder not found: {image_folder}")
        return

    # Check if the clip folder exists, if not, handle only images
    clips_available = os.path.exists(clip_folder)

    # Get sorted lists of images and clips
    images = sorted([f for f in os.listdir(image_folder) if f.endswith('.png') and f != '1.png' and '_raw' not in f])
    clips = sorted([f for f in os.listdir(clip_folder) if f.endswith('.mp4') and f != '1.mp4']) if clips_available else []

    # Create a temporary file list for concatenation
    temp_file_list = os.path.join(projectFolder, 'file_list.txt')

    # Extract scene numbers from images and clips to ensure correct order
    image_numbers = {int(os.path.splitext(image)[0]) for image in images}
    clip_numbers = {int(os.path.splitext(clip)[0]) for clip in clips} if clips_available else set()

    all_numbers = sorted(image_numbers.union(clip_numbers))

    with open(temp_file_list, 'w') as f:
        for num in all_numbers:
            if clips_available and f"{num}.mp4" in clips:
                # Use the clip if available (with both video and audio)
                clip_path = os.path.join(clip_folder, f"{num}.mp4")
                f.write(f"file '{clip_path}'\n")
            elif f"{num}.png" in images:
                # Use the image if no clip exists (image with 5-second duration, no audio)
                image_path = os.path.join(image_folder, f"{num}.png")
                temp_video_path = os.path.join(projectFolder, f'tmp_{num}.mp4')
                # Create a temporary 5-second video from the image with specific codec and format
                ffmpeg.input(image_path, loop=1, t=5).output(
                    temp_video_path, 
                    vcodec="libx264", 
                    pix_fmt="yuv420p", 
                    acodec="aac"
                ).run(overwrite_output=True)
                f.write(f"file '{temp_video_path}'\n")

    # Concatenate videos and clips with audio where applicable
    try:
        ffmpeg.input(temp_file_list, format='concat', safe=0).output(
            output_file, 
            vcodec='libx264', 
            acodec='aac', 
            pix_fmt="yuv420p", 
            strict='experimental'
        ).run(overwrite_output=True)
        print(f"Video successfully created: {output_file}")
    except ffmpeg.Error as e:
        print(f"Error during concatenation: {e.stderr.decode()}")

    # Clean up temporary files
    for num in all_numbers:
        temp_video_path = os.path.join(projectFolder, f'tmp_{num}.mp4')
        if os.path.exists(temp_video_path):
            os.remove(temp_video_path)
    os.remove(temp_file_list)

    # Open the file to play it
    if sys.platform == "win32":
        os.startfile(output_file)  # Windows
    elif sys.platform == "darwin":
        subprocess.run(["open", output_file])  # macOS
    else:
        subprocess.run(["xdg-open", output_file])  # Linux

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python renderProject.py <projectFolder> <outputFilePath>")
        sys.exit(1)

    projectFolder = sys.argv[1]
    output_file = sys.argv[2]
    renderProject(projectFolder, output_file)