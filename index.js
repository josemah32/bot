r// index.js - Postgres integration + lazy migration
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Pool } = require('pg');
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
  EmbedBuilder
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const ADMIN_PASSWORD = "germangey";

// EPHEMERAL flag numeric (compatibilidad)
const EPHEMERAL = 64;

/* -------------------- DB: fallback local (db.json) -------------------- */
const DB_FILE = path.join(__dirname, 'db.json');
let localDb = {};
// cargar local db si existe
if (fs.existsSync(DB_FILE)) {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    localDb = raw ? JSON.parse(raw) : {};
    console.log('[DB] local cargada ->', Object.keys(localDb).length, 'entradas');
  } catch (err) {
    console.error('[DB] error leyendo local db.json:', err);
    localDb = {};
  }
} else {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(localDb, null, 2), 'utf8');
    console.log('[DB] archivo db.json creado (local fallback)');
  } catch (err) {
    console.error('[DB] error creando db.json:', err);
  }
}
function saveLocalDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(localDb, null, 2), 'utf8');
    console.log('[DB] local guardada');
  } catch (err) {
    console.error('[DB] error guardando local db.json:', err);
  }
}

/* -------------------- Postgres (opcional) -------------------- */
const PG_URL = process.env.DATABASE_URL;
let pool = null;

if (PG_URL) {
  pool = new Pool({
    connectionString: PG_URL,
    // supabase requires ssl; if self-hosted adjust accordingly
    ssl: { rejectUnauthorized: false }
  });

  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tokens (
          user_id TEXT PRIMARY KEY,
          tokens NUMERIC DEFAULT 0
        );
      `);
      console.log('[PG] tabla tokens lista');
    } catch (err) {
      console.error('[PG] error creando tabla tokens:', err);
    }
  })();
} else {
  console.log('[PG] DATABASE_URL no definido: usando fallback local (db.json)');
}

/* -------------------- Helpers DB abstracción -------------------- */

// Lazy migration: si pool existe y usuario está solo en localDb, migrarlo
async function migrateUserIfNeeded(userId) {
  if (!pool) return;
  // comprobar si ya existe en PG
  const res = await pool.query('SELECT tokens FROM tokens WHERE user_id = $1', [userId]);
  if (res.rowCount) return; // ya existe en PG
  const localVal = localDb[userId];
  if (localVal !== undefined && Number(localVal) > 0) {
    // insertar en PG y borrar local (o setear 0)
    await pool.query('INSERT INTO tokens(user_id, tokens) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET tokens = EXCLUDED.tokens', [userId, Number(localVal)]);
    console.log(`[MIGRATE] usuario ${userId} migrado a PG: ${localVal}`);
    // opcionalmente limpiar local
    localDb[userId] = 0;
    saveLocalDB();
  }
}

// devuelve Number
async function getTokens(userId) {
  if (pool) {
    try {
      await migrateUserIfNeeded(userId);
      const r = await pool.query('SELECT tokens FROM tokens WHERE user_id = $1', [userId]);
      return r.rowCount ? Number(r.rows[0].tokens) : 0;
    } catch (err) {
      console.error('[PG] getTokens error:', err);
      // fallback a local
      return localDb[userId] ? Number(localDb[userId]) : 0;
    }
  } else {
    return localDb[userId] ? Number(localDb[userId]) : 0;
  }
}

// delta puede ser negativo
async function changeTokens(userId, delta) {
  if (!userId) throw new Error('userId requerido en changeTokens');
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // UPSERT sumando
      await client.query(`
        INSERT INTO tokens(user_id, tokens)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE
          SET tokens = tokens + EXCLUDED.tokens;
      `, [userId, delta]);
      const r = await client.query('SELECT tokens FROM tokens WHERE user_id = $1', [userId]);
      await client.query('COMMIT');
      const nuevo = r.rows[0] ? Number(r.rows[0].tokens) : 0;
      console.log(`[PG] changeTokens ${userId}: ${nuevo} (delta ${delta})`);
      return nuevo;
    } catch (err) {
      await client.query('ROLLBACK').catch(()=>{});
      console.error('[PG] changeTokens error:', err);
      throw err;
    } finally {
      client.release();
    }
  } else {
    // fallback local
    if (!localDb[userId]) localDb[userId] = 0;
    const antes = Number(localDb[userId]);
    localDb[userId] = Number((antes + delta).toFixed(2));
    saveLocalDB();
    console.log(`[DB-FALLBACK] changeTokens ${userId}: ${localDb[userId]} (antes ${antes}, delta ${delta})`);
    return localDb[userId];
  }
}

// set absoluto (opcional)
async function setTokens(userId, value) {
  if (pool) {
    await pool.query(`
      INSERT INTO tokens(user_id, tokens) VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET tokens = $2
    `, [userId, value]);
    return Number(value);
  } else {
    localDb[userId] = Number(value);
    saveLocalDB();
    return localDb[userId];
  }
}

/* -------------------- Express (web) -------------------- */

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

// send-embed/sent-tokens como tenías antes (omito por brevedad — los mantén igual si ya funcionan)

app.listen(PORT, HOST, () => console.log(`Servidor corriendo en http://${HOST}:${PORT}`));

/* -------------------- Bot (discord) -------------------- */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

// global handlers logs
process.on('unhandledRejection', (r) => console.error('[UNHANDLED REJECTION]', r));
process.on('uncaughtException', (e) => console.error('[UNCAUGHT EXCEPTION]', e));
client.on('error', (e) => console.error('[CLIENT ERROR]', e));

client.once('ready', () => console.log(`Conectado como ${client.user.tag}`));

/* --- Comandos registration (igual que antes) --- */
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
  } catch (err) { console.error('Error registrando comandos:', err); }
})();

/* -------------------- Eventos: messageCreate (ahora async) -------------------- */
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const id = message.author.id;
  try {
    await changeTokens(id, +1); // suma 1 token por mensaje
  } catch (err) {
    console.error('messageCreate changeTokens error:', err);
  }
});

/* -------------------- Interactions -------------------- */

client.on('interactionCreate', async interaction => {
  console.log('[INTERACTION]', {
    id: interaction.id,
    type: interaction.type,
    user: interaction.user?.tag,
    command: interaction.commandName ?? null,
    customId: interaction.customId ?? null
  });

  async function safeReply(inter, options) {
    try {
      if (!inter) return null;
      if (inter.replied || inter.deferred) {
        return await inter.followUp(options).catch(e => { console.error('followUp failed:', e); });
      } else {
        return await inter.reply(options).catch(e => { console.error('reply failed:', e); });
      }
    } catch (e) { console.error('safeReply error:', e); }
  }

  try {
    const userId = interaction.user?.id;

    // MODAL SUBMIT (silenciar/ensordecer)
    if (interaction.isModalSubmit()) {
      const parts = interaction.customId?.split('_') || [];
      if (parts[0] === 'modal') {
        const accion = parts[1];
        const targetId = parts[2];
        const tiempo = Number(interaction.fields.getTextInputValue('tiempo')) || 30;
        const coste = 0.1 * tiempo;

        const tokensUser = await getTokens(userId);
        if (tokensUser < coste) return await safeReply(interaction, { content: `❌ Necesitas ${coste.toFixed(1)} tokens para esto.`, flags: EPHEMERAL });

        // cobrar
        await changeTokens(userId, -coste);

        const miembro = await interaction.guild.members.fetch(targetId).catch(()=>null);
        if (!miembro) {
          // devolver tokens si no encuentra
          await changeTokens(userId, +coste);
          return await safeReply(interaction, { content: '❌ Usuario no encontrado.', flags: EPHEMERAL });
        }

        try {
          const res = await aplicarEfecto(miembro, accion, tiempo);
          if (res?.error) throw new Error(res.error);
        } catch (err) {
          console.error('Error aplicando efecto desde modal:', err);
          // devolver tokens
          await changeTokens(userId, +coste);
          return await safeReply(interaction, { content: '❌ No se pudo aplicar la acción (comprueba permisos/jerarquía).', flags: EPHEMERAL });
        }

        await logAccion(client, interaction.user.tag, accion, miembro.user.tag, tiempo, coste);
        return await safeReply(interaction, { content: `✅ ${accion} aplicado a ${miembro.user.tag} por ${tiempo}s. (-${coste.toFixed(1)} tokens)`, flags: EPHEMERAL });
      }
    }

    // COMANDOS
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'tokens') {
        const t = await getTokens(userId);
        return await safeReply(interaction, { content: `💰 Tienes ${t} tokens.`, flags: EPHEMERAL });
      }

      if (interaction.commandName === 'info') {
        const infoMsg = `
📖 **Sistema de Tokens**
- Por cada mensaje enviado ganas: +1 token
- Coste de acciones: 🔇 Silenciar → 0.1 tokens * segundos, 🔈 Ensordecer → 0.1 tokens * segundos, ❌ Desconectar → 1 token
- Comandos: /tokens, /admin, /info
        `;
        return await safeReply(interaction, { content: infoMsg, flags: EPHEMERAL });
      }

      if (interaction.commandName === 'admin') {
        const tokensUser = await getTokens(userId);
        if (tokensUser < 1) return await safeReply(interaction, { content: '❌ Necesitas al menos 1 token para usar admin.', flags: EPHEMERAL });

        const miembrosVC = (await interaction.guild.members.fetch()).filter(m => m.voice.channel && m.id !== userId);
        if (!miembrosVC.size) return await safeReply(interaction, { content: '❌ No hay miembros en canales de voz.', flags: EPHEMERAL });

        await interaction.deferReply({ flags: EPHEMERAL }).catch(()=>{});
        const select = new StringSelectMenuBuilder()
          .setCustomId('select_member')
          .setPlaceholder('Selecciona un usuario')
          .addOptions(miembrosVC.map(m => ({ label: m.user.username, value: m.id })));

        return await safeReply(interaction, { content: 'Selecciona un usuario para aplicar acción:', components: [new ActionRowBuilder().addComponents(select)], flags: EPHEMERAL });
      }

      if (interaction.commandName === 'robar') {
        const objetivo = interaction.options.getUser('objetivo');
        const cantidad = interaction.options.getInteger('cantidad');
        const tokensUser = await getTokens(userId);
        if (!db) {} // noop to keep linter quiet if db used elsewhere
        if (!objetivo) return await safeReply(interaction, { content: '❌ Usuario objetivo inválido.', flags: EPHEMERAL });

        const coste = Math.ceil(cantidad * 0.5);
        const probabilidad = Math.max(10, 70 - cantidad * 2);
        if (tokensUser < coste) return await safeReply(interaction, { content: `❌ Necesitas al menos ${coste} tokens para intentar el robo.`, flags: EPHEMERAL });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(JSON.stringify({ type: 'robo', objetivoId: objetivo.id, cantidad, coste, probabilidad }))
            .setLabel('Confirmar robo')
            .setStyle(ButtonStyle.Danger)
        );

        return await safeReply(interaction, {
          content: `⚠️ Vas a intentar robar **${cantidad} tokens** a ${objetivo.tag}.\nCoste: **${coste} tokens**\nProbabilidad de éxito: **${probabilidad}%**\n\n¿Confirmas?`,
          components: [row],
          flags: EPHEMERAL
        });
      }
    }

    // SELECCIÓN
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_member') {
      const targetId = interaction.values[0];
      const miembro = await interaction.guild.members.fetch(targetId).catch(()=>null);
      if (!miembro || !miembro.voice.channel) return await safeReply(interaction, { content: '❌ Usuario no válido o no está en VC.', flags: EPHEMERAL });

      const acciones = ['silenciar', 'ensordecer', 'desconectar'];
      const botones = new ActionRowBuilder().addComponents(
        acciones.map(a => new ButtonBuilder().setCustomId(`accion_${a}_${targetId}`).setLabel(a.charAt(0).toUpperCase() + a.slice(1)).setStyle(ButtonStyle.Primary))
      );

      return await safeReply(interaction, { content: `Usuario seleccionado: ${miembro.user.tag}. Elige acción:`, components: [botones], flags: EPHEMERAL });
    }

    // BOTONES
    if (interaction.isButton()) {
      const custom = interaction.customId;

      // accion_xxx -> mostrar modal o confirmar
      if (custom.startsWith('accion_')) {
        const [_, accion, targetId] = custom.split('_');
        const miembro = await interaction.guild.members.fetch(targetId).catch(()=>null);
        if (!miembro) return await safeReply(interaction, { content: '❌ Usuario no encontrado.', flags: EPHEMERAL });

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
          return await safeReply(interaction, { content: `Desconectar a ${miembro.user.tag} cuesta ${coste} token. ¿Confirmas?`, components: [confirmRow], flags: EPHEMERAL });
        }
      }

      // confirmar_* -> cobrar y aplicar
      if (custom.startsWith('confirmar_')) {
        const [_, accion, targetId, costeStr] = custom.split('_');
        const coste = Number(costeStr) || 0;
        const tokensUser = await getTokens(userId);
        if (tokensUser < coste) return await safeReply(interaction, { content: '❌ No tienes suficientes tokens.', flags: EPHEMERAL });

        const miembro = await interaction.guild.members.fetch(targetId).catch(()=>null);
        if (!miembro) return await safeReply(interaction, { content: '❌ Usuario no encontrado.', flags: EPHEMERAL });

        // cobrar + intentar aplicar
        await changeTokens(userId, -coste);
        try {
          const res = await aplicarEfecto(miembro, accion);
          if (res?.error) throw new Error(res.error);
        } catch (err) {
          console.error('Error aplicando efecto en confirmar:', err);
          // devolver tokens
          await changeTokens(userId, +coste);
          return await safeReply(interaction, { content: '❌ No se pudo aplicar la acción (permisos/jerarquía).', flags: EPHEMERAL });
        }

        await logAccion(client, interaction.user.tag, accion, miembro.user.tag, 0, coste);

        if (interaction.message) {
          try {
            return await interaction.update({ content: `✅ ${miembro.user.tag} ha sido ${accion} por ${interaction.user.tag} (-${coste} tokens).`, components: [] });
          } catch (e) {
            console.error('update failed:', e);
            return await safeReply(interaction, { content: `✅ ${miembro.user.tag} ha sido ${accion} (-${coste} tokens).`, flags: EPHEMERAL });
          }
        } else {
          return await safeReply(interaction, { content: `✅ ${miembro.user.tag} ha sido ${accion} (-${coste} tokens).`, flags: EPHEMERAL });
        }
      }

      // ROBO
      let data;
      try { data = JSON.parse(custom); } catch { data = null; }
      if (data && data.type === 'robo') {
        const { objetivoId, cantidad, coste, probabilidad } = data;
        const tokensUser = await getTokens(userId);
        if (tokensUser < coste) return await safeReply(interaction, { content: `❌ No tienes suficientes tokens para confirmar.`, flags: EPHEMERAL });

        const objetivoTokens = await getTokens(objetivoId);
        const miembro = await interaction.guild.members.fetch(objetivoId).catch(()=>null);
        if (!miembro) return await safeReply(interaction, { content: '❌ Usuario no encontrado.', flags: EPHEMERAL });

        // cobrar coste
        await changeTokens(userId, -coste);

        const exito = Math.random() * 100 < probabilidad;
        let resultadoMsg, mensajePublico;
        if (exito) {
          const robado = Math.min(cantidad, objetivoTokens);
          if (robado > 0) {
            await changeTokens(objetivoId, -robado);
            await changeTokens(userId, +robado);
          }
          resultadoMsg = `✅ Has robado **${robado} tokens** de ${miembro.user.tag}. Te quedan ${await getTokens(userId)} tokens.`;
          mensajePublico = `💰 **${interaction.user.username}** ha robado **${robado} tokens** de **${miembro.user.username}**!`;
        } else {
          resultadoMsg = `❌ Fallaste el robo a ${miembro.user.tag}. Perdiste ${coste} tokens. Te quedan ${await getTokens(userId)} tokens.`;
          mensajePublico = `❌ **${interaction.user.username}** falló el robo a **${miembro.user.username}** y perdió ${coste} tokens.`;
        }

        await logAccion(client, interaction.user.tag, `Robo ${exito ? 'exitoso' : 'fallido'}`, miembro.user.tag, 0, coste);
        try { if (interaction.channel) await interaction.channel.send(mensajePublico); } catch(e){ console.error('No se pudo enviar mensaje público:', e); }
        return await safeReply(interaction, { content: resultadoMsg, flags: EPHEMERAL });
      }

    } // fin isButton

  } catch (err) {
    console.error('[HANDLER ERROR]', err);
    try {
      if (interaction && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Error interno al procesar la interacción.', flags: EPHEMERAL });
      } else if (interaction) {
        await interaction.followUp({ content: '❌ Error interno al procesar la interacción.', flags: EPHEMERAL });
      }
    } catch (e) { console.error('Error replying after handler crash:', e); }
  }
});

/* -------------------- Funciones auxiliares que ya tenías -------------------- */

async function logAccion(client, usuario, accion, target, duracion, coste) {
  try {
    const canalLogs = client.channels.cache.get(LOG_CHANNEL_ID) || await client.channels.fetch(LOG_CHANNEL_ID).catch(()=>null);
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
        setTimeout(() => { member.voice.setMute(false).catch(()=>{}); }, duracion * 1000);
        return { success: true };
      case 'ensordecer':
        await member.voice.setDeaf(true).catch(e => { throw e; });
        setTimeout(() => { member.voice.setDeaf(false).catch(()=>{}); }, duracion * 1000);
        return { success: true };
      case 'desconectar':
        try {
          if (typeof member.voice.disconnect === 'function') {
            await member.voice.disconnect();
            return { success: true };
          }
          if (typeof member.voice.setChannel === 'function') {
            await member.voice.setChannel(null);
            return { success: true };
          }
          throw new Error('Disconnect not available');
        } catch (err) { throw err; }
      default:
        return { error: 'Acción desconocida.' };
    }
  } catch (err) {
    console.error('Error aplicando efecto:', err);
    return { error: 'Ocurrió un error al aplicar el efecto.' };
  }
}

/* -------------------- Login -------------------- */
client.login(TOKEN).catch(err => console.error('Login failed:', err));
