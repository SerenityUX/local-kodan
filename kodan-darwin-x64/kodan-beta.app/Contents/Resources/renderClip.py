import os
import ffmpeg

def renderClip(projectPath, sceneNumber):
    # Define paths
    image_path = os.path.join(projectPath, 'Images', f'{sceneNumber}.png')
    audio_path = os.path.join(projectPath, 'Voicelines', f'{sceneNumber}.mp3')
    output_dir = os.path.join(projectPath, 'Clips')
    output_path = os.path.join(output_dir, f'{sceneNumber}.mp4')

    # Ensure both image and audio files exist
    if not os.path.exists(image_path):
        print(f"Image not found: {image_path}")
        return None
    if not os.path.exists(audio_path):
        print(f"Audio not found: {audio_path}")
        return None

    # Ensure the output directory exists
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"Created directory: {output_dir}")

    # Generate the video clip using the provided approach
    try:
        input_still = ffmpeg.input(image_path, loop=1)
        input_audio = ffmpeg.input(audio_path)

        (
            ffmpeg
            .output(input_still, input_audio, output_path, vcodec="libx264", acodec="aac", pix_fmt="yuv420p", shortest=None)
            .run(overwrite_output=True)
        )

        print(f"Clip saved as {output_path}")
        return output_path
    except ffmpeg.Error as e:
        # Check if there is any error output, and print it
        error_message = e.stderr.decode() if e.stderr else "Unknown ffmpeg error"
        print(f"An error occurred: {error_message}")
        return None

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 3:
        print("Usage: python renderClip.py <projectPath> <sceneNumber>")
        sys.exit(1)

    projectPath = sys.argv[1]
    sceneNumber = sys.argv[2]
    renderClip(projectPath, sceneNumber)
