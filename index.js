import { Client, GatewayIntentBits } from "discord.js";
import express from "express";

// --- Servidor Express para UptimeRobot ---
const app = express();
app.get("/", (req, res) => {
  res.send("Bot está activo 🚀");
});
app.listen(3000, () => console.log("Servidor web en puerto 3000"));

// --- Configuración del cliente de Discord ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Evento cuando el bot se conecta
client.once("ready", () => {
  console.log(`Conectado como ${client.user.tag}`);
});

// Respuesta a mensajes
client.on("messageCreate", (msg) => {
  if (msg.content === "!ping") {
    msg.reply("🏓 Pong!");
  }
});

// Iniciar sesión con token
client.login(process.env.TOKEN);
