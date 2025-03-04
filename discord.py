import discord
import requests
import asyncio
import json
from googleapiclient.discovery import build

# Configuración
DISCORD_TOKEN = "TU_DISCORD_BOT_TOKEN"
YOUTUBE_API_KEY = "TU_YOUTUBE_API_KEY"
TWITCH_CLIENT_ID = "TU_TWITCH_CLIENT_ID"
TWITCH_CLIENT_SECRET = "TU_TWITCH_CLIENT_SECRET"
DISCORD_CHANNEL_ID = 123456789012345678  # Reemplaza con tu ID de canal
YOUTUBER_ID = "UC_x5XG1OV2P6uZZ5FSM9Ttw"  # ID del canal de YouTube
TWITCH_USERNAME = "nombre_del_streamer"  # Nombre del streamer de Twitch

intents = discord.Intents.default()
client = discord.Client(intents=intents)

# Inicializar API de YouTube
youtube = build("youtube", "v3", developerKey=YOUTUBE_API_KEY)

# Obtener el último video subido
def get_latest_youtube_video():
    request = youtube.search().list(
        part="snippet",
        channelId=YOUTUBER_ID,
        maxResults=1,
        order="date"
    )
    response = request.execute()
    if response["items"]:
        video = response["items"][0]
        video_id = video["id"]["videoId"]
        video_url = f"https://www.youtube.com/watch?v={video_id}"
        return video_url
    return None

# Obtener estado del streamer en Twitch
def get_twitch_stream_status():
    headers = {
        "Client-ID": TWITCH_CLIENT_ID,
        "Authorization": f"Bearer {get_twitch_token()}"
    }
    url = f"https://api.twitch.tv/helix/streams?user_login={TWITCH_USERNAME}"
    response = requests.get(url, headers=headers).json()
    return response.get("data") and len(response["data"]) > 0

# Obtener token de Twitch
def get_twitch_token():
    url = "https://id.twitch.tv/oauth2/token"
    params = {
        "client_id": TWITCH_CLIENT_ID,
        "client_secret": TWITCH_CLIENT_SECRET,
        "grant_type": "client_credentials"
    }
    response = requests.post(url, params=params).json()
    return response["access_token"]

# Monitoreo de YouTube y Twitch
async def check_notifications():
    await client.wait_until_ready()
    channel = client.get_channel(DISCORD_CHANNEL_ID)
    last_video = None
    was_live = False

    while not client.is_closed():
        # Verificar nuevo video de YouTube
        latest_video = get_latest_youtube_video()
        if latest_video and latest_video != last_video:
            await channel.send(f"🎥 ¡Nuevo video subido! {latest_video}")
            last_video = latest_video

        # Verificar si el streamer está en vivo en Twitch
        is_live = get_twitch_stream_status()
        if is_live and not was_live:
            await channel.send(f"🔴 ¡{TWITCH_USERNAME} está en vivo en Twitch! https://www.twitch.tv/{TWITCH_USERNAME}")
        was_live = is_live

        await asyncio.sleep(60)  # Revisa cada 60 segundos

@client.event
async def on_ready():
    print(f"Bot conectado como {client.user}")
    client.loop.create_task(check_notifications())

client.run(DISCORD_TOKEN)
