import sys
import os
from TTS.api import TTS
import ffmpeg

def generate_mp3_from_text(prompt, output_location, max_length=250, speaker_wav="./morgan.wav", language="en"):

    # Extract the directory from the output location and ensure it exists
    output_dir = os.path.dirname(output_location)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"Created directory: {output_dir}")

    # Initialize TTS
    tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2", gpu=False)

    # Function to split the prompt into segments if necessary
    def split_prompt_if_needed(prompt, max_length):
        if len(prompt) <= max_length:
            return [prompt]
        
        segments = []
        current_segment = ""
        words = prompt.split(' ')

        for word in words:
            if len(current_segment) + len(word) + 1 <= max_length:
                current_segment += word + " "
            else:
                if current_segment:
                    segments.append(current_segment.strip())
                    current_segment = ""
                current_segment = word + " "

        if current_segment:
            segments.append(current_segment.strip())

        return segments

    # Split the prompt into segments if needed
    segments = split_prompt_if_needed(prompt, max_length)

    # Generate an MP3 file for each segment (or just one if it's small enough)
    output_files = []
    for i, segment in enumerate(segments):
        # If there is more than one segment, we append numbers to the filenames
        output_file = f"{os.path.splitext(output_location)[0]}_{i + 1}.mp3" if len(segments) > 1 else output_location
        try:
            tts.tts_to_file(
                text=segment,
                file_path=output_file,
                speaker_wav=speaker_wav,
                language=language
            )
            output_files.append(output_file)
        except ValueError as e:
            print(f"Error processing segment {i + 1}: {e}")

    # If there's only one file, return it directly
    if len(output_files) == 1:
        print(f"MP3 saved as {output_files[0]}")
        return output_files[0]

    # Merge all the generated MP3 files into one if multiple segments exist
    if output_files:
        merged_file = f"{os.path.splitext(output_location)[0]}_final.mp3"
        input_files = [ffmpeg.input(file) for file in output_files]
        ffmpeg.concat(*input_files, v=0, a=1).output(merged_file).run()
        print(f"Merged MP3 saved as {merged_file}")
        return merged_file
    else:
        print("No MP3 files were generated due to errors.")
        return None

if __name__ == "__main__":
    # Check if the correct number of arguments is passed
    if len(sys.argv) < 3:
        print("Usage: python voice.py <prompt> <output_location> [max_length] [speaker_wav] [language]")
        sys.exit(1)
    # Extract arguments from command line
    prompt = sys.argv[1]
    output_location = sys.argv[2]
    max_length = int(sys.argv[3]) if len(sys.argv) > 3 else 250
    speaker_wav = sys.argv[4] if len(sys.argv) > 4 else "./morgan.wav"
    language = sys.argv[5] if len(sys.argv) > 5 else "en"

    # Call the function with the extracted arguments
    generate_mp3_from_text(prompt, output_location, max_length, speaker_wav, language)
