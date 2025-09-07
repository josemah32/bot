require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const ADMIN_PASSWORD = "germangey";

////////////////////////////////////////////WEB///////////////////////////////////////////////////////////

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASSWORD) return res.status(403).send('❌ Acceso denegado');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Ruta POST para enviar embeds
app.post('/send-embed', async (req, res) => {
  try {
    const { channelId, title, description, color, image, thumbnail, author, footer, fields } = req.body;
    if (!channelId) return res.status(400).send('❌ No se proporcionó un ID de canal');

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased())
      return res.status(400).send('❌ Canal inválido o el bot no tiene acceso');

    const embed = new EmbedBuilder();
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    embed.setColor(color ? parseInt(color.replace('#', ''), 16) : 0x0099ff);
    if (image) embed.setImage(image);
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (author) embed.setAuthor({ name: author });
    if (footer) embed.setFooter({ text: footer });
    if (fields?.length) embed.addFields(fields.map(f => ({ name: f.name, value: f.value })));

    await channel.send({ embeds: [embed] });
    res.status(200).send('✅ Embed enviado correctamente');
  } catch (err) {
    console.error(err);
    res.status(500).send('❌ Error al enviar el embed');
  }
});

// Ruta POST para enviar tokens
app.post('/send-tokens', async (req, res) => {
  try {
    const { cantidad, canalId, mensaje } = req.body;
    const channel = await client.channels.fetch(canalId);

    const boton = new ButtonBuilder()
      .setCustomId(`claim_tokens_${cantidad}`)
      .setLabel(`¡Reclamar ${cantidad} tokens!`)
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(boton);

    await channel.send({
      content: mensaje || `Haz click para reclamar ${cantidad} tokens!`,
      components: [row]
    });

    res.status(200).send('✅ Mensaje de tokens enviado');
  } catch (err) {
    console.error(err);
    res.status(500).send('❌ Error al enviar mensaje de tokens');
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Servidor corriendo en http://${HOST}:${PORT}`);
});

////////////////////////////////////////////BOT///////////////////////////////////////////////////////////

let db = {};
const DB_FILE = './db.json';
if (fs.existsSync(DB_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DB_FILE)); }
  catch (err) { console.error('Error leyendo db.json:', err); db = {}; }
}
function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

client.once('ready', () => {
  console.log(`Conectado como ${client.user.tag}`);
});

///////////////////////////////////// FUNCIONES /////////////////////////////////////

async function logAccion(client, usuario, accion, target, duracion, coste) {
  try {
    const canalLogs = client.channels.cache.get(LOG_CHANNEL_ID);
    if (!canalLogs) return console.warn("⚠️ Canal de logs no encontrado");

    const embed = new EmbedBuilder()
      .setTitle("📝 Acción Admin")
      .setColor(0xffa500)
      .addFields(
        { name: "👤 Usuario", value: usuario, inline: true },
        { name: "🎯 Objetivo", value: target, inline: true },
        { name: "⚡ Acción", value: accion, inline: true },
        { name: "⏳ Duración", value: `${duracion || 0}s`, inline: true },
        { name: "💰 Coste", value: `${coste.toFixed(1)} tokens`, inline: true }
      )
      .setTimestamp();

    await canalLogs.send({ embeds: [embed] });
  } catch (err) { console.error("Error enviando log:", err); }
}

async function aplicarEfecto(member, efecto, duracion = 30) {
  try {
    if (!member.voice.channel) return { error: 'El usuario no está en un canal de voz.' };

    switch (efecto) {
      case 'silenciar':
        await member.voice.setMute(true);
        setTimeout(() => member.voice.setMute(false), duracion * 1000);
        return { success: true };
      case 'ensordecer':
        await member.voice.setDeaf(true);
        setTimeout(() => member.voice.setDeaf(false), duracion * 1000);
        return { success: true };
      case 'desconectar':
        await member.voice.disconnect();
        return { success: true };
      default: return { error: 'Acción desconocida.' };
    }
  } catch (err) {
    console.error('Error aplicando efecto:', err);
    return { error: 'Ocurrió un error al aplicar el efecto.' };
  }
}

///////////////////////////////////// COMANDOS /////////////////////////////////////

const commands = [
  new SlashCommandBuilder().setName('admin').setDescription('Usa tus tokens para acciones').toJSON(),
  new SlashCommandBuilder().setName('tokens').setDescription('Muestra tus tokens').toJSON(),
  new SlashCommandBuilder()
    .setName('robar')
    .setDescription('Intenta robar tokens a alguien')
    .addUserOption(opt => opt.setName('objetivo').setDescription('Usuario a robar').setRequired(true))
    .addIntegerOption(opt => opt.setName('cantidad').setDescription('Cantidad de tokens').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder().setName('info').setDescription('Muestra info del sistema').toJSON()
];

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => { await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands }); })();

///////////////////////////////////// EVENTOS /////////////////////////////////////

client.on('messageCreate', message => {
  if (message.author.bot) return;
  const id = message.author.id;
  if (!db[id]) db[id] = 0;
  db[id] += 1;
  saveDB();
});

client.on('interactionCreate', async interaction => {
  const userId = interaction.user.id;

  try {
    // ------------------- COMANDOS -------------------
    if (interaction.isChatInputCommand()) {
      await interaction.deferReply({ ephemeral: true }); // ✅ evitar Unknown Interaction

      if (interaction.commandName === 'tokens') {
        await interaction.editReply({ content: `💰 Tienes ${db[userId] || 0} tokens.` });
        return;
      }

      if (interaction.commandName === 'info') {
        const infoMsg = `
📖 **Sistema de Tokens**
- Por cada mensaje enviado ganas: +1 token
- Coste de acciones: 🔇 Silenciar → 0.1 tokens * segundos, 🔈 Ensordecer → 0.1 tokens * segundos, ❌ Desconectar → 1 token
- Comandos: /tokens, /admin, /info
        `;
        await interaction.editReply({ content: infoMsg });
        return;
      }

      if (interaction.commandName === 'admin') {
        if (!db[userId] || db[userId] < 1) {
          await interaction.editReply({ content: '❌ Necesitas al menos 1 token para usar admin.' });
          return;
        }

        const miembrosVC = (await interaction.guild.members.fetch()).filter(m => m.voice.channel && m.id !== userId);
        if (!miembrosVC.size) {
          await interaction.editReply({ content: '❌ No hay miembros en canales de voz.' });
          return;
        }

        const select = new StringSelectMenuBuilder()
          .setCustomId('select_member')
          .setPlaceholder('Selecciona un usuario')
          .addOptions(miembrosVC.map(m => ({ label: m.user.username, value: m.id })));

        await interaction.editReply({
          content: 'Selecciona un usuario para aplicar acción:',
          components: [new ActionRowBuilder().addComponents(select)]
        });
        return;
      }

      if (interaction.commandName === 'robar') {
        const objetivo = interaction.options.getUser('objetivo');
        const cantidad = interaction.options.getInteger('cantidad');
        if (!db[userId]) db[userId] = 0;
        if (!db[objetivo.id]) db[objetivo.id] = 0;

        const coste = Math.ceil(cantidad * 0.5);
        const probabilidad = Math.max(10, 70 - cantidad * 2);
        if (db[userId] < coste) {
          await interaction.editReply({ content: `❌ Necesitas al menos ${coste} tokens para intentar el robo.` });
          return;
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(JSON.stringify({ type: 'robo', objetivoId: objetivo.id, cantidad, coste, probabilidad }))
            .setLabel('Confirmar robo')
            .setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({
          content: `⚠️ Vas a intentar robar **${cantidad} tokens** a ${objetivo.tag}.\nCoste: **${coste} tokens**\nProbabilidad de éxito: **${probabilidad}%**\n\n¿Confirmas?`,
          components: [row]
        });
        return;
      }
    }

    // ------------------- SELECT -------------------
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_member') {
      await interaction.deferReply({ ephemeral: true });

      const targetId = interaction.values[0];
      const miembro = interaction.guild.members.cache.get(targetId);
      if (!miembro || !miembro.voice.channel) {
        await interaction.editReply({ content: '❌ Usuario no válido o no está en VC.' });
        return;
      }

      const acciones = ['silenciar', 'ensordecer', 'desconectar'];
      const botones = new ActionRowBuilder().addComponents(
        acciones.map(a =>
          new ButtonBuilder()
            .setCustomId(`accion_${a}_${targetId}`)
            .setLabel(a.charAt(0).toUpperCase() + a.slice(1))
            .setStyle(ButtonStyle.Primary)
        )
      );

      await interaction.editReply({
        content: `Usuario seleccionado: ${miembro.user.tag}. Elige acción:`,
        components: [botones]
      });
      return;
    }

    // ------------------- BOTONES -------------------
    if (interaction.isButton()) {
      await interaction.deferReply({ ephemeral: true });

      // CONFIRMAR DESCONECTAR
      if (interaction.customId.startsWith("confirmar_desconectar_")) {
        const [_, __, targetId] = interaction.customId.split("_");
        const miembro = interaction.guild.members.cache.get(targetId);
        if (!miembro) {
          await interaction.editReply({ content: "❌ Usuario no encontrado." });
          return;
        }

        const coste = 1;
        if (!db[userId]) db[userId] = 0;
        if (db[userId] < coste) {
          await interaction.editReply({ content: "❌ No tienes suficientes tokens." });
          return;
        }

        db[userId] -= coste;
        saveDB();
        await miembro.voice.disconnect();

        await logAccion(client, interaction.user.tag, "Desconectar", miembro.user.tag, 0, coste);

        await interaction.channel.send(
          `❌ **${interaction.user.username}** desconectó a **${miembro.user.username}** (coste: ${coste} tokens)`
        );

        await interaction.editReply({
          content: `✅ Has desconectado a ${miembro.user.tag}. Te quedan ${db[userId].toFixed(1)} tokens.`
        });
        return;
      }

      // BOTÓN DE ROBO
      let data;
      try { data = JSON.parse(interaction.customId); } catch { return; }
      if (data.type !== 'robo') return;

      const { objetivoId, cantidad, coste, probabilidad } = data;

      if (!db[userId]) db[userId] = 0;
      if (!db[objetivoId]) db[objetivoId] = 0;

      if (db[userId] < coste) {
        await interaction.editReply({ content: `❌ No tienes suficientes tokens para confirmar.` });
        return;
      }

      const miembro = await interaction.guild.members.fetch(objetivoId).catch(() => null);
      if (!miembro) return;

      db[userId] -= coste;
      const exito = Math.random() * 100 < probabilidad;

      let resultadoMsg = '';
      let mensajePublico = '';

      if (exito) {
        const robado = Math.min(cantidad, db[objetivoId]);
        db[objetivoId] -= robado;
        db[userId] += robado;

        resultadoMsg = `✅ Has robado **${robado} tokens** de ${miembro.user.tag}. Te quedan ${db[userId].toFixed(1)} tokens.`;
        mensajePublico = `💰 **${interaction.user.username}** ha robado **${robado} tokens** de **${miembro.user.username}**!`;
      } else {
        resultadoMsg = `❌ Fallaste el robo a ${miembro.user.tag}. Perdistes ${coste} tokens. Te quedan ${db[userId].toFixed(1)} tokens.`;
        mensajePublico = `❌ **${interaction.user.username}** ha fallado el robo a **${miembro.user.username}** y perdió ${coste} tokens.`;
      }

      saveDB();
      await logAccion(client, interaction.user.tag, `Robo ${exito ? 'exitoso' : 'fallido'}`, miembro.user.tag, 0, coste);

      await interaction.channel.send(mensajePublico);
      await interaction.editReply({ content: resultadoMsg });
      return;
    }

    // ------------------- MODALES -------------------
    if (interaction.isModalSubmit()) {
      await interaction.deferReply({ ephemeral: true });

      const [_, accion, targetId] = interaction.customId.split('_');
      const tiempo = parseInt(interaction.fields.getTextInputValue('tiempo'));
      const miembro = interaction.guild.members.cache.get(targetId);
      if (!miembro || isNaN(tiempo) || tiempo <= 0) {
        await interaction.editReply({ content: '❌ Datos inválidos.' });
        return;
      }

      const coste = tiempo * 0.1;
      if (db[userId] < coste) {
        await interaction.editReply({
          content: `❌ No tienes suficientes tokens. Necesitas ${coste.toFixed(1)}.`
        });
        return;
      }

      const resultado = await aplicarEfecto(miembro, accion, tiempo);
      if (resultado.error) {
        await interaction.editReply({ content: `❌ ${resultado.error}` });
        return;
      }

      db[userId] -= coste;
      saveDB();
      await logAccion(client, interaction.user.tag, accion, miembro.user.tag, tiempo, coste);
      await interaction.editReply({
        content: `✅ Aplicaste **${accion}** a ${miembro.user.tag} durante ${tiempo}s. Te quedan ${db[userId].toFixed(1)} tokens.`
      });
    }
  } catch (err) {
    console.error("Error en interacción:", err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ Error procesando la interacción.", ephemeral: true }).catch(() => {});
    } else if (interaction.deferred) {
      await interaction.editReply({ content: "❌ Error procesando la interacción." }).catch(() => {});
    }
  }
});

client.login(TOKEN);
