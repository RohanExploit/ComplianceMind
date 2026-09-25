import os
import subprocess
import shutil
from moviepy import VideoFileClip, ImageClip, AudioFileClip, concatenate_videoclips

# Project paths (E: drive) to avoid filling C: drive
PROJECT_DIR = r"e:\Project\HAckathon"
TEMP_DIR = os.path.join(PROJECT_DIR, "temp_video_build")
FINAL_OUTPUT = os.path.join(PROJECT_DIR, "ComplianceMind_Demo.mp4")

# Brain paths (source files)
BRAIN_DIR = r"C:\Users\ACER\.gemini\antigravity-ide\brain\90b9132d-3bbc-4a12-9d3b-dbdcf0338e0e"
SCENE1_WEBP = os.path.join(BRAIN_DIR, "scene1_dashboard_1790107358404.webp")
SCENE2_WEBP = os.path.join(BRAIN_DIR, "scene2_flag_transaction_1790107482955.webp")
SCENE3_PNG = os.path.join(BRAIN_DIR, "scene3_moss_metrics_final_1790108128496.png")
SCENE5_WEBP = os.path.join(BRAIN_DIR, "scene5_teach_agent_1790108225233.webp")
AUDIO_FILE = os.path.join(BRAIN_DIR, "scratch", "voiceover_v2.mp3")

if not os.path.exists(TEMP_DIR):
    os.makedirs(TEMP_DIR)

def convert_webp_to_mp4(webp_path, mp4_path):
    """Converts webp to mp4 with exact 1920x1080 framing to prevent stride/glitch artifacts."""
    print(f"Converting {os.path.basename(webp_path)}...")
    subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-i", webp_path,
        "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p",
        "-c:v", "libx264", "-crf", "15", "-preset", "fast", mp4_path
    ], check=True)

SCENE1_MP4 = os.path.join(TEMP_DIR, "scene1.mp4")
SCENE2_MP4 = os.path.join(TEMP_DIR, "scene2.mp4")
SCENE5_MP4 = os.path.join(TEMP_DIR, "scene5.mp4")

convert_webp_to_mp4(SCENE1_WEBP, SCENE1_MP4)
convert_webp_to_mp4(SCENE2_WEBP, SCENE2_MP4)
convert_webp_to_mp4(SCENE5_WEBP, SCENE5_MP4)

def load_and_extend(filepath, target_duration):
    """Loads a clip and freezes its last frame to match the target duration."""
    if filepath.endswith('.png'):
        clip = ImageClip(filepath)
        return clip.with_duration(target_duration)
    
    clip = VideoFileClip(filepath)
    if clip.duration < target_duration:
        last_frame = clip.get_frame(clip.duration - 0.1)
        freeze_clip = ImageClip(last_frame).with_duration(target_duration - clip.duration)
        clip = concatenate_videoclips([clip, freeze_clip])
    else:
        clip = clip.subclipped(0, target_duration)
    
    return clip

print("Loading audio...")
audio = AudioFileClip(AUDIO_FILE)
total_duration = audio.duration

# Timestamps
T1 = 25.0
T2 = 65.0
T3 = 95.0

print("Building Scenes...")
clip1 = load_and_extend(SCENE1_MP4, T1)
clip2 = load_and_extend(SCENE2_MP4, T2 - T1)
clip3 = load_and_extend(SCENE3_PNG, T3 - T2).resized(width=1920, height=1080)
clip5 = load_and_extend(SCENE5_MP4, total_duration - T3)

print("Rendering final video...")
final_video = concatenate_videoclips([clip1, clip2, clip3, clip5])
final_video = final_video.with_audio(audio)

final_video.write_videofile(
    FINAL_OUTPUT, 
    fps=15, 
    codec="libx264", 
    audio_codec="aac",
    bitrate="8000k",
    preset="fast"
)

# Clean up temp files to save space
print("Cleaning up temp files...")
try:
    if hasattr(audio, 'close'): audio.close()
    if hasattr(final_video, 'close'): final_video.close()
except:
    pass
shutil.rmtree(TEMP_DIR, ignore_errors=True)

print(f"Successfully created standard HD video at {FINAL_OUTPUT}")
