require('dotenv').config();
const fs = require('fs');
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

////////////////////////////////////////////WEB///////////////////////////////////////////////////////////

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (req, res) => {
    if(req.query.pass !== ADMIN_PASSWORD) return res.status(403).send('❌ Acceso denegado');
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/set-bot-status', async (req, res) => {
    try {
        const { type, name, status } = req.body;
        client.user.setActivity(name, { type });
        client.user.setStatus(status);
        res.sendStatus(200);
    } catch(err) {
        console.error(err);
        res.sendStatus(500);
    }
});
app.post('/send-embed', async (req, res) => {
  try {
    const { channelId, title, description, color, image, thumbnail, author, footer, fields } = req.body;

    // Validar que se haya enviado un canal
    if (!channelId) return res.status(400).send('❌ No se proporcionó un ID de canal');

    // Obtener el canal
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased())
      return res.status(400).send('❌ Canal inválido o el bot no tiene acceso');

    // Crear embed
    const embed = new EmbedBuilder();

    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    embed.setColor(color ? parseInt(color.replace('#', ''), 16) : 0x0099ff);
    if (image) embed.setImage(image);
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (author) embed.setAuthor({ name: author });
    if (footer) embed.setFooter({ text: footer });
    if (fields?.length) embed.addFields(fields.map(f => ({ name: f.name, value: f.value })));

    // Enviar embed
    await channel.send({ embeds: [embed] }).catch(err => {
      console.error('Error al enviar embed:', err);
      return res.status(500).send('❌ Error al enviar el embed: ' + err.message);
    });

    res.status(200).send('✅ Embed enviado correctamente');
  } catch (err) {
    console.error(err);
    res.status(500).send('❌ Error al enviar el embed');
  }
});

// Enviar mensaje para dar tokens
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
  } catch(err) {
    console.error(err);
    res.status(500).send('Error al enviar mensaje de tokens');
  }
});

app.post('/set-bot-status', async (req, res) => {
  const { type, name, status } = req.body;

  try {
    client.user.setActivity(name, { type }); // Cambia la actividad
    client.user.setStatus(status); // Cambia el estado
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.listen(PORT, HOST, () => console.log(`Servidor corriendo en http://${HOST}:${PORT}`));

////////////////////////////////////////////BOT///////////////////////////////////////////////////////////

let db = {};
const DB_FILE = './db.json';
if(fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE));
function saveDB(){ fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

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

  try {
    client.user.setActivity(name, { type }); // Cambia la actividad
    client.user.setStatus(status); // Cambia el estado
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// Comandos
const commands = [
  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Usa tus tokens para hacer acciones temporales sobre otros usuarios')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('tokens')
    .setDescription('Muestra tus tokens')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('robar')
    .setDescription('Hace falta explicacion?')
    .addUserOption(opt => opt.setName('objetivo').setDescription('Usuario al que intentas robar').setRequired(true))
    .addIntegerOption(opt => opt.setName('cantidad').setDescription('Cantidad de tokens que intentas robar').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('info')
    .setDescription('Muestra información sobre ganancias y costes')
    .toJSON()
];

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
})();

// Contador de mensajes
client.on('messageCreate', message => {
  if (message.author.bot) return;
  const id = message.author.id;
  if (!db[id]) db[id] = 0;
  db[id] += 1;
  saveDB();
  console.log(`[LOG] ${message.author.tag} ha enviado un mensaje. Total tokens: ${db[id]}`);
});
// 📌 Función para enviar logs
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
  } catch (err) {
    console.error("Error enviando log:", err);
  }
}

client.on('interactionCreate', async interaction => {
  if (interaction.isButton() && interaction.customId.startsWith('claim_tokens_')) {
    const cantidad = parseFloat(interaction.customId.split('_')[2]);
    const userId = interaction.user.id;

    // Comprobar si ya hay ganador
    if (db[`token_claim_${interaction.message.id}`]) {
      await interaction.reply({ content: '❌ Ya se ha reclamado este bono de tokens.', ephemeral: true });
      return;
    }

    // Registrar usuario y dar tokens
    db[`token_claim_${interaction.message.id}`] = userId;
    if (!db[userId]) db[userId] = 0;
    db[userId] += cantidad;
    saveDB();

    await interaction.reply({ content: `✅ Has recibido ${cantidad} tokens!`, ephemeral: true });

    // Log en canal de logs
    const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
    if(logChannel){
      const embed = new EmbedBuilder()
        .setTitle('💰 Token reclamado')
        .setDescription(`${interaction.user.tag} ha reclamado ${cantidad} tokens`)
        .setColor(0x00ff00)
        .setTimestamp();
      await logChannel.send({ embeds: [embed] });
    }

    // Desactivar botón
    const row = interaction.message.components[0];
    row.components[0].setDisabled(true);
    await interaction.message.edit({ components: [row] });
  }
});


// Función para aplicar efectos
async function aplicarEfecto(member, efecto, duracion = 30) {
  try {
    if (!member.voice.channel) return { error: 'El usuario no está en un canal de voz.' };

    switch (efecto) {
      case 'silenciar':
        await member.voice.setMute(true);
        setTimeout(() => member.voice.setMute(false), duracion * 1000);
        console.log(`[LOG] Silenciando a ${member.user.tag} por ${duracion}s`);
        return { success: true };

      case 'ensordecer':
        await member.voice.setDeaf(true);
        setTimeout(() => member.voice.setDeaf(false), duracion * 1000);
        console.log(`[LOG] Ensordeciendo a ${member.user.tag} por ${duracion}s`);
        return { success: true };

      case 'desconectar':
        await member.voice.disconnect("Acción admin temporal");
        console.log(`[LOG] Desconectando a ${member.user.tag}`);
        return { success: true };

      default:
        return { error: 'Acción desconocida.' };
    }
  } catch (err) {
    console.error('Error aplicando efecto:', err);
    return { error: 'Ocurrió un error al aplicar el efecto.' };
  }
}

// Interacciones de comandos
client.on('interactionCreate', async interaction => {
  const userId = interaction.user.id;

  // /tokens
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'tokens') {
      const tokens = db[userId] || 0;
      await interaction.reply({ content: `💰 Tienes ${tokens} tokens.`, ephemeral: true });
      return;
    }

if (interaction.commandName === 'info') {
      const infoMsg = `
📖 **Sistema de Tokens**

- Por cada **mensaje enviado** ganas: **+1 token**
- **Coste de acciones:**
   • 🔇 Silenciar → \`0.1 tokens * segundos\`
   • 🔈 Ensordecer → \`0.1 tokens * segundos\`
   • ❌ Desconectar → \`1 token\`

⚙️ **Comandos disponibles:**
- \`/tokens\` → ver tus tokens actuales
- \`/admin\` → usar tokens para aplicar acciones
- \`/info\` → mostrar esta información
      `;
      await interaction.reply({ content: infoMsg, ephemeral: true });
      return;
    }

    if (interaction.commandName === 'admin') {
      if (!db[userId] || db[userId] < 1) {
        await interaction.reply({ content: '❌ Necesitas al menos 1 token para usar admin.', ephemeral: true });
        return;
      }

      await interaction.guild.members.fetch();
      const miembrosVC = interaction.guild.members.cache.filter(m => m.voice.channel && m.id !== userId);
      if (!miembrosVC.size) {
        await interaction.reply({ content: '❌ No hay miembros en canales de voz.', ephemeral: true });
        return;
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId('select_member')
        .setPlaceholder('Selecciona un usuario')
        .addOptions(miembrosVC.map(m => ({ label: m.user.username, value: m.id })));

      await interaction.reply({ content: 'Selecciona un usuario para aplicar acción:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }
  }

  // Menú de selección
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_member') {
    await interaction.deferUpdate();
    const targetId = interaction.values[0];
    const miembro = interaction.guild.members.cache.get(targetId);
    if (!miembro || !miembro.voice.channel) {
      await interaction.followUp({ content: '❌ Usuario no válido o no está en VC.', ephemeral: true });
      return;
    }

    const acciones = ['silenciar', 'ensordecer', 'desconectar'];
    const botones = new ActionRowBuilder().addComponents(
      acciones.map(a => new ButtonBuilder().setCustomId(`accion_${a}_${targetId}`).setLabel(a.charAt(0).toUpperCase() + a.slice(1)).setStyle(ButtonStyle.Primary))
    );

    await interaction.followUp({ content: `Usuario seleccionado: ${miembro.user.tag}. Elige acción:`, components: [botones], ephemeral: true });
  }

  // Botones de acción
  if (interaction.isButton() && interaction.customId.startsWith('accion_')) {
    const [_, accion, targetId] = interaction.customId.split('_');
    const miembro = interaction.guild.members.cache.get(targetId);
    if (!miembro) return;

    if (['silenciar', 'ensordecer'].includes(accion)) {
      const modal = new ModalBuilder()
        .setCustomId(`modal_${accion}_${targetId}`)
        .setTitle(`Duración de ${accion}`);
      const input = new TextInputBuilder().setCustomId('tiempo').setLabel('Duración en segundos').setStyle(TextInputStyle.Short).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
    } else if (accion === 'desconectar') {
      const coste = 1;
      if (db[userId] < coste) {
        await interaction.reply({ content: `❌ No tienes suficientes tokens.`, ephemeral: true });
        return;
      }
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`confirmar_${accion}_${targetId}_0`).setLabel(`Confirmar (${coste} tokens)`).setStyle(ButtonStyle.Danger));
      await interaction.reply({ content: `Desconectar a ${miembro.user.tag} cuesta ${coste} tokens. ¿Confirmas?`, components: [row], ephemeral: true });
    }
  }
   
// Comando /robar
if (interaction.isChatInputCommand() && interaction.commandName === 'robar') {
  const objetivo = interaction.options.getUser('objetivo');
  const cantidad = interaction.options.getInteger('cantidad');
  const ladrónId = interaction.user.id;

  // Validaciones
  if (!objetivo) return interaction.reply({ content: '❌ Usuario no válido.', ephemeral: true });
  if (objetivo.id === ladrónId) return interaction.reply({ content: '❌ No puedes robarte a ti mismo.', ephemeral: true });
  if (cantidad <= 0) return interaction.reply({ content: '❌ La cantidad debe ser mayor a 0.', ephemeral: true });

  if (!db[ladrónId]) db[ladrónId] = 0;
  if (!db[objetivo.id]) db[objetivo.id] = 0;

  // Coste y probabilidad
  const coste = Math.ceil(cantidad * 0.5);
  let probExito = 70 - (cantidad * 2);
  if (probExito < 10) probExito = 10;

  if (db[ladrónId] < coste) return interaction.reply({ content: `❌ Necesitas al menos ${coste} tokens para intentar este robo.`, ephemeral: true });

  // 🔹 BOTÓN DE CONFIRMACIÓN
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(JSON.stringify({
        type: 'robo',
        objetivoId: objetivo.id,
        cantidad,
        coste,
        probabilidad: probExito
      }))
      .setLabel('Confirmar robo')
      .setStyle(ButtonStyle.Danger)
  );

  // Enviar mensaje al usuario con botón
  await interaction.reply({
    content: `⚠️ Vas a intentar robar **${cantidad} tokens** a ${objetivo.tag}.\nCoste: **${coste} tokens**\nProbabilidad de éxito: **${probExito}%**\n\n¿Confirmas?`,
    components: [row],
    ephemeral: true
  });
}

// 🔹 Manejo del botón de confirmación
if (interaction.isButton()) {
  let data;
  try {
    data = JSON.parse(interaction.customId);
  } catch {
    return interaction.update({ content: '❌ Error interno, customId inválido.', components: [], ephemeral: true });
  }

  if (data.type !== 'robo') return;

  const { objetivoId, cantidad, coste, probabilidad } = data;
  const ladrónId = interaction.user.id;

  if (!db[ladrónId]) db[ladrónId] = 0;
  if (!db[objetivoId]) db[objetivoId] = 0;

  if (db[ladrónId] < coste) {
    return interaction.update({ content: `❌ No tienes suficientes tokens para confirmar.`, components: [], ephemeral: true });
  }

  // Fetch seguro del miembro
  let miembro;
  try {
    miembro = await interaction.guild.members.fetch({ user: objetivoId, force: true });
  } catch {
    return interaction.update({ content: '❌ No se pudo encontrar al usuario.', components: [], ephemeral: true });
  }

  if (!miembro) return interaction.update({ content: '❌ No se pudo encontrar al usuario.', components: [], ephemeral: true });

  // Descontar coste
  db[ladrónId] -= coste;

  // Probabilidad de éxito
  const exito = Math.random() * 100 < probabilidad;

  let resultadoMsg = '';
  let canalGeneral = interaction.guild.channels.cache.find(c => c.name.toLowerCase().includes('general')); // busca canal general

  if (exito) {
    const robado = Math.min(cantidad, db[objetivoId]);
    db[objetivoId] -= robado;
    db[ladrónId] += robado;

    resultadoMsg = `✅ Has logrado robar **${robado} tokens** de ${miembro.user.tag}. (Coste ${coste} tokens). Te quedan ${db[ladrónId].toFixed(1)} tokens.`;

    // Log en canal de logs
    await logAccion(client, interaction.user.tag, `Robar (${robado})`, miembro.user.tag, 0, coste);

    // Mensaje en general
    if(canalGeneral) {
      canalGeneral.send(`💰 ${interaction.user.tag} ha robado **${robado} tokens** a ${miembro.user.tag}!`);
    }

  } else {
    resultadoMsg = `❌ Fallaste el robo a ${miembro.user.tag}. Perdiste **${coste} tokens**. Te quedan ${db[ladrónId].toFixed(1)} tokens.`;

    // Log en canal de logs
    await logAccion(client, interaction.user.tag, `Intento fallido de robar (${cantidad})`, miembro.user.tag, 0, coste);

    // Mensaje en general
    if(canalGeneral) {
      canalGeneral.send(`⚠️ ${interaction.user.tag} ha intentado robar **${cantidad} tokens** a ${miembro.user.tag} pero ha fallado.`);
    }
  }

  saveDB();
  await interaction.update({ content: resultadoMsg, components: [] });
}
    
  // Modales
  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_')) {
    const [_, accion, targetId] = interaction.customId.split('_');
    const miembro = interaction.guild.members.cache.get(targetId);
    const tiempo = parseInt(interaction.fields.getTextInputValue('tiempo'));
    if (isNaN(tiempo) || tiempo <= 0) {
      await interaction.reply({ content: '❌ Tiempo no válido.', ephemeral: true });
      return;
    }

    const coste = tiempo * 0.1;
    if (db[userId] < coste) {
      await interaction.reply({ content: `❌ No tienes suficientes tokens. Necesitas ${coste.toFixed(1)}.`, ephemeral: true });
      return;
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirmar_${accion}_${targetId}_${tiempo}`).setLabel(`Confirmar (${coste.toFixed(1)} tokens)`).setStyle(ButtonStyle.Primary)
    );

    await interaction.reply({ content: `Aplicar ${accion} a ${miembro.user.tag} durante ${tiempo}s cuesta ${coste.toFixed(1)} tokens. ¿Confirmas?`, components: [row], ephemeral: true });
  }

  // Confirmar acción
  if (interaction.isButton() && interaction.customId.startsWith('confirmar_')) {
    const [_, accion, targetId, tiempoStr] = interaction.customId.split('_');
    const tiempo = parseInt(tiempoStr) || 0;
    const miembro = interaction.guild.members.cache.get(targetId);

    let coste = accion === 'desconectar' ? 1 : tiempo * 0.1;
    if (db[userId] < coste) {
      await interaction.reply({ content: `❌ No tienes suficientes tokens. Necesitas ${coste.toFixed(1)}.`, ephemeral: true });
      return;
    }

    const resultado = await aplicarEfecto(miembro, accion, tiempo);
    if (resultado.error) {
    await interaction.reply({ content: `❌ ${resultado.error}`, ephemeral: true });
    return;
   }

   db[userId] -= coste;
saveDB();

// ✅ Log en canal
await logAccion(
  client,
  interaction.user.tag,
  accion,
  miembro.user.tag,
  tiempo,
  coste
);

await interaction.reply({ content: `✅ Aplicaste **${accion}** a ${miembro.user.tag} durante ${tiempo || 0}s. Te quedan ${db[userId].toFixed(1)} tokens.`, ephemeral: true });
  }
});

client.login(TOKEN);
