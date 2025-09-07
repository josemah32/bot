// index.js - versión corregida y robusta
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
  InteractionResponseFlags
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const ADMIN_PASSWORD = "germangey";

//////////////////////////////////////////// WEB ///////////////////////////////////////////

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASSWORD) return res.status(403).send('❌ Acceso denegado');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/send-embed', async (req, res) => {
  try {
    const { channelId, title, description, color, image, thumbnail, author, footer, fields } = req.body;
    if (!channelId) return res.status(400).send('❌ No se proporcionó un ID de canal');

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return res.status(400).send('❌ Canal inválido o el bot no tiene acceso');

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
    console.error('Error send-embed:', err);
    res.status(500).send('❌ Error al enviar el embed');
  }
});

app.post('/send-tokens', async (req, res) => {
  try {
    const { cantidad, canalId, mensaje } = req.body;
    const channel = await client.channels.fetch(canalId);
    const boton = new ButtonBuilder()
      .setCustomId(`claim_tokens_${cantidad}`)
      .setLabel(`¡Reclamar ${cantidad} tokens!`)
      .setStyle(ButtonStyle.Primary);
    const row = new ActionRowBuilder().addComponents(boton);
    await channel.send({ content: mensaje || `Haz click para reclamar ${cantidad} tokens!`, components: [row] });
    res.status(200).send('Mensaje de tokens enviado');
  } catch (err) {
    console.error('Error send-tokens:', err);
    res.status(500).send('Error al enviar mensaje de tokens');
  }
});

app.listen(PORT, HOST, () => console.log(`Servidor corriendo en http://${HOST}:${PORT}`));

//////////////////////////////////////////// BOT ///////////////////////////////////////////

let db = {};
const DB_FILE = './db.json';
if (fs.existsSync(DB_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DB_FILE)); } catch (err) { console.error('Error leyendo db.json:', err); db = {}; }
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

// Handlers globales para no morir con excepciones sin capturar
process.on('unhandledRejection', (reason) => console.error('[UNHANDLED REJECTION]', reason));
process.on('uncaughtException', (err) => console.error('[UNCAUGHT EXCEPTION]', err));
client.on('error', (err) => console.error('[CLIENT ERROR]', err));

client.once('ready', () => console.log(`Conectado como ${client.user.tag}`));

///////////////////////////////////// FUNCIONES /////////////////////////////////////

async function logAccion(client, usuario, accion, target, duracion, coste) {
  try {
    const canalLogs = client.channels.cache.get(LOG_CHANNEL_ID) || await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (!canalLogs) return console.warn('⚠️ Canal de logs no encontrado');
    const embed = new EmbedBuilder()
      .setTitle('📝 Acción Admin')
      .setColor(0xffa500)
      .addFields(
        { name: '👤 Usuario', value: usuario ?? 'N/A', inline: true },
        { name: '🎯 Objetivo', value: target ?? 'N/A', inline: true },
        { name: '⚡ Acción', value: accion ?? 'N/A', inline: true },
        { name: '⏳ Duración', value: `${duracion || 0}s`, inline: true },
        { name: '💰 Coste', value: `${(coste || 0).toFixed ? (coste).toFixed(1) : String(coste)}`, inline: true }
      )
      .setTimestamp();
    await canalLogs.send({ embeds: [embed] });
  } catch (err) { console.error('Error enviando log:', err); }
}

async function aplicarEfecto(member, efecto, duracion = 30) {
  try {
    if (!member || !member.voice || !member.voice.channel) return { error: 'El usuario no está en un canal de voz.' };

    switch (efecto) {
      case 'silenciar':
        await member.voice.setMute(true).catch(e => { throw e; });
        setTimeout(() => { member.voice.setMute(false).catch(() => {}); }, duracion * 1000);
        return { success: true };
      case 'ensordecer':
        await member.voice.setDeaf(true).catch(e => { throw e; });
        setTimeout(() => { member.voice.setDeaf(false).catch(() => {}); }, duracion * 1000);
        return { success: true };
      case 'desconectar':
        // Intentamos desconectar de forma segura
        try {
          if (typeof member.voice.disconnect === 'function') {
            await member.voice.disconnect();
            return { success: true };
          }
          // fallback: mover a null (si la función existe)
          if (typeof member.voice.setChannel === 'function') {
            await member.voice.setChannel(null);
            return { success: true };
          }
          // última opción: si la librería no lo soporta, lanzar
          throw new Error('Disconnect not available');
        } catch (err) {
          // si falla por permisos o jerarquía, propagar para ser manejado arriba
          throw err;
        }
      default:
        return { error: 'Acción desconocida.' };
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
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Comandos registrados');
  } catch (err) {
    console.error('Error registrando comandos:', err);
  }
})();

///////////////////////////////////// EVENTOS /////////////////////////////////////

client.on('messageCreate', message => {
  if (message.author.bot) return;
  const id = message.author.id;
  if (!db[id]) db[id] = 0;
  db[id] += 1;
  saveDB();
});

client.on('interactionCreate', async interaction => {
  console.log('[INTERACTION]', {
    id: interaction.id,
    type: interaction.type,
    user: interaction.user?.tag,
    command: interaction.commandName ?? null,
    customId: interaction.customId ?? null
  });

  // helper para responder de forma segura y evitar colisiones
  async function safeReply(inter, options) {
    try {
      if (!inter) return null;
      if (inter.replied || inter.deferred) {
        return await inter.followUp(options).catch(e => { console.error('followUp failed:', e); });
      } else {
        return await inter.reply(options).catch(e => { console.error('reply failed:', e); });
      }
    } catch (e) {
      console.error('safeReply error:', e);
    }
  }

  try {
    const userId = interaction.user?.id;

    // ---- MODAL SUBMIT (duraciones para silenciar/ensordecer) ----
    if (interaction.isModalSubmit()) {
      const parts = interaction.customId?.split('_') || [];
      if (parts[0] === 'modal') {
        const accion = parts[1];
        const targetId = parts[2];
        const tiempo = Number(interaction.fields.getTextInputValue('tiempo')) || 30;
        const coste = 0.1 * tiempo;

        if (!db[userId]) db[userId] = 0;
        if (db[userId] < coste) {
          return await safeReply(interaction, { content: `❌ Necesitas ${coste.toFixed(1)} tokens para esto.`, flags: InteractionResponseFlags.Ephemeral });
        }

        const miembro = await interaction.guild.members.fetch(targetId).catch(() => null);
        if (!miembro) {
          return await safeReply(interaction, { content: '❌ Usuario no encontrado.', flags: InteractionResponseFlags.Ephemeral });
        }

        // Cobrar y aplicar
        db[userId] -= coste;
        saveDB();

        try {
          const res = await aplicarEfecto(miembro, accion, tiempo);
          if (res?.error) throw new Error(res.error);
        } catch (err) {
          console.error('Error aplicando efecto desde modal:', err);
          // devolver tokens si falló
          db[userId] += coste;
          saveDB();
          return await safeReply(interaction, { content: '❌ No se pudo aplicar la acción (comprueba permisos/jerarquía).', flags: InteractionResponseFlags.Ephemeral });
        }

        await logAccion(client, interaction.user.tag, accion, miembro.user.tag, tiempo, coste);
        return await safeReply(interaction, { content: `✅ ${accion} aplicado a ${miembro.user.tag} por ${tiempo}s. (-${coste.toFixed(1)} tokens)`, flags: InteractionResponseFlags.Ephemeral });
      }
    }

    // ------------------- COMANDOS -------------------
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'tokens') {
        return await safeReply(interaction, { content: `💰 Tienes ${db[userId] || 0} tokens.`, flags: InteractionResponseFlags.Ephemeral });
      }

      if (interaction.commandName === 'info') {
        const infoMsg = `
📖 **Sistema de Tokens**
- Por cada mensaje enviado ganas: +1 token
- Coste de acciones: 🔇 Silenciar → 0.1 tokens * segundos, 🔈 Ensordecer → 0.1 tokens * segundos, ❌ Desconectar → 1 token
- Comandos: /tokens, /admin, /info
        `;
        return await safeReply(interaction, { content: infoMsg, flags: InteractionResponseFlags.Ephemeral });
      }

      if (interaction.commandName === 'admin') {
        if (!db[userId] || db[userId] < 1) {
          return await safeReply(interaction, { content: '❌ Necesitas al menos 1 token para usar admin.', flags: InteractionResponseFlags.Ephemeral });
        }

        const miembrosVC = (await interaction.guild.members.fetch()).filter(m => m.voice.channel && m.id !== userId);
        if (!miembrosVC.size) {
          return await safeReply(interaction, { content: '❌ No hay miembros en canales de voz.', flags: InteractionResponseFlags.Ephemeral });
        }

        // deferimos (ephemeral) para dar tiempo si hace falta
        await interaction.deferReply({ flags: InteractionResponseFlags.Ephemeral }).catch(() => {});

        const select = new StringSelectMenuBuilder()
          .setCustomId('select_member')
          .setPlaceholder('Selecciona un usuario')
          .addOptions(miembrosVC.map(m => ({ label: m.user.username, value: m.id })));

        return await safeReply(interaction, { content: 'Selecciona un usuario para aplicar acción:', components: [new ActionRowBuilder().addComponents(select)], flags: InteractionResponseFlags.Ephemeral });
      }

      if (interaction.commandName === 'robar') {
        const objetivo = interaction.options.getUser('objetivo');
        const cantidad = interaction.options.getInteger('cantidad');
        if (!db[userId]) db[userId] = 0;
        if (!db[objetivo.id]) db[objetivo.id] = 0;

        const coste = Math.ceil(cantidad * 0.5);
        const probabilidad = Math.max(10, 70 - cantidad * 2);
        if (db[userId] < coste) {
          return await safeReply(interaction, { content: `❌ Necesitas al menos ${coste} tokens para intentar el robo.`, flags: InteractionResponseFlags.Ephemeral });
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(JSON.stringify({ type: 'robo', objetivoId: objetivo.id, cantidad, coste, probabilidad }))
            .setLabel('Confirmar robo')
            .setStyle(ButtonStyle.Danger)
        );

        return await safeReply(interaction, {
          content: `⚠️ Vas a intentar robar **${cantidad} tokens** a ${objetivo.tag}.\nCoste: **${coste} tokens**\nProbabilidad de éxito: **${probabilidad}%**\n\n¿Confirmas?`,
          components: [row],
          flags: InteractionResponseFlags.Ephemeral
        });
      }
    }

    // ------------------- MENÚ DE SELECCIÓN -------------------
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_member') {
      const targetId = interaction.values[0];
      const miembro = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!miembro || !miembro.voice.channel) {
        return await safeReply(interaction, { content: '❌ Usuario no válido o no está en VC.', flags: InteractionResponseFlags.Ephemeral });
      }

      const acciones = ['silenciar', 'ensordecer', 'desconectar'];
      const botones = new ActionRowBuilder().addComponents(
        acciones.map(a => new ButtonBuilder().setCustomId(`accion_${a}_${targetId}`).setLabel(a.charAt(0).toUpperCase() + a.slice(1)).setStyle(ButtonStyle.Primary))
      );

      return await safeReply(interaction, { content: `Usuario seleccionado: ${miembro.user.tag}. Elige acción:`, components: [botones], flags: InteractionResponseFlags.Ephemeral });
    }

    // ------------------- BOTONES -------------------
    if (interaction.isButton()) {
      const custom = interaction.customId;

      // acciones iniciales: mostrar modal o pedir confirmación
      if (custom.startsWith('accion_')) {
        const [_, accion, targetId] = custom.split('_');
        const miembro = await interaction.guild.members.fetch(targetId).catch(() => null);
        if (!miembro) return await safeReply(interaction, { content: '❌ Usuario no encontrado.', flags: InteractionResponseFlags.Ephemeral });

        if (['silenciar', 'ensordecer'].includes(accion)) {
          const modal = new ModalBuilder().setCustomId(`modal_${accion}_${targetId}`).setTitle(`Duración de ${accion}`);
          const input = new TextInputBuilder().setCustomId('tiempo').setLabel('Duración en segundos').setStyle(TextInputStyle.Short).setRequired(true);
          modal.addComponents(new ActionRowBuilder().addComponents(input));
          return await interaction.showModal(modal);
        }

        if (accion === 'desconectar') {
          const coste = 1;
          const confirmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`confirmar_${accion}_${targetId}_${coste}`).setLabel(`Confirmar (${coste} tokens)`).setStyle(ButtonStyle.Danger)
          );
          return await safeReply(interaction, { content: `Desconectar a ${miembro.user.tag} cuesta ${coste} token. ¿Confirmas?`, components: [confirmRow], flags: InteractionResponseFlags.Ephemeral });
        }
      }

      // confirmar_* -> ejecuta la acción y cobra
      if (custom.startsWith('confirmar_')) {
        const [_, accion, targetId, costeStr] = custom.split('_');
        const coste = Number(costeStr) || 0;
        if (!db[userId]) db[userId] = 0;
        if (db[userId] < coste) return await safeReply(interaction, { content: '❌ No tienes suficientes tokens.', flags: InteractionResponseFlags.Ephemeral });

        const miembro = await interaction.guild.members.fetch(targetId).catch(() => null);
        if (!miembro) return await safeReply(interaction, { content: '❌ Usuario no encontrado.', flags: InteractionResponseFlags.Ephemeral });

        // intentar cobrar y aplicar con control de errores
        db[userId] -= coste;
        saveDB();
        try {
          const res = await aplicarEfecto(miembro, accion);
          if (res?.error) throw new Error(res.error);
        } catch (err) {
          console.error('Error aplicando efecto en confirmar:', err);
          db[userId] += coste; // devolver tokens
          saveDB();
          return await safeReply(interaction, { content: '❌ No se pudo aplicar la acción (permisos/jerarquía).', flags: InteractionResponseFlags.Ephemeral });
        }

        await logAccion(client, interaction.user.tag, accion, miembro.user.tag, 0, coste);

        // intentamos actualizar el mensaje original si existe, si no usamos safeReply
        if (interaction.message) {
          try {
            return await interaction.update({ content: `✅ ${miembro.user.tag} ha sido ${accion} por ${interaction.user.tag} (-${coste} tokens).`, components: [] });
          } catch (e) {
            console.error('update failed:', e);
            return await safeReply(interaction, { content: `✅ ${miembro.user.tag} ha sido ${accion} (-${coste} tokens).`, flags: InteractionResponseFlags.Ephemeral });
          }
        } else {
          return await safeReply(interaction, { content: `✅ ${miembro.user.tag} ha sido ${accion} (-${coste} tokens).`, flags: InteractionResponseFlags.Ephemeral });
        }
      }

      // robo (payload JSON)
      let data;
      try { data = JSON.parse(custom); } catch { data = null; }
      if (data && data.type === 'robo') {
        const { objetivoId, cantidad, coste, probabilidad } = data;
        if (!db[userId]) db[userId] = 0;
        if (!db[objetivoId]) db[objetivoId] = 0;
        if (db[userId] < coste) return await safeReply(interaction, { content: `❌ No tienes suficientes tokens para confirmar.`, flags: InteractionResponseFlags.Ephemeral });

        const miembro = await interaction.guild.members.fetch(objetivoId).catch(() => null);
        if (!miembro) return await safeReply(interaction, { content: '❌ Usuario no encontrado.', flags: InteractionResponseFlags.Ephemeral });

        db[userId] -= coste;
        const exito = Math.random() * 100 < probabilidad;
        let resultadoMsg, mensajePublico;
        if (exito) {
          const robado = Math.min(cantidad, db[objetivoId]);
          db[objetivoId] -= robado;
          db[userId] += robado;
          resultadoMsg = `✅ Has robado **${robado} tokens** de ${miembro.user.tag}. Te quedan ${db[userId].toFixed(1)} tokens.`;
          mensajePublico = `💰 **${interaction.user.username}** ha robado **${robado} tokens** de **${miembro.user.username}**!`;
        } else {
          resultadoMsg = `❌ Fallaste el robo a ${miembro.user.tag}. Perdiste ${coste} tokens. Te quedan ${db[userId].toFixed(1)} tokens.`;
          mensajePublico = `❌ **${interaction.user.username}** falló el robo a **${miembro.user.username}** y perdió ${coste} tokens.`;
        }

        saveDB();
        await logAccion(client, interaction.user.tag, `Robo ${exito ? 'exitoso' : 'fallido'}`, miembro.user.tag, 0, coste);

        try { if (interaction.channel) await interaction.channel.send(mensajePublico); } catch (e) { console.error('No se pudo enviar mensaje público:', e); }
        return await safeReply(interaction, { content: resultadoMsg, flags: InteractionResponseFlags.Ephemeral });
      }
    } // fin isButton
  } catch (err) {
    console.error('[HANDLER ERROR]', err);
    try {
      if (interaction && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Error interno al procesar la interacción.', flags: InteractionResponseFlags.Ephemeral });
      } else if (interaction) {
        await interaction.followUp({ content: '❌ Error interno al procesar la interacción.', flags: InteractionResponseFlags.Ephemeral });
      }
    } catch (e) {
      console.error('Error replying after handler crash:', e);
    }
  }
});

client.login(TOKEN).catch(err => console.error('Login failed:', err));
