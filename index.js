require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const game = require("./game");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ── In-memory game sessions: keyed by `${userId}-${dateStr}` ──
const sessions = new Map();
let cachedPrices = {};
let lastPriceFetch = 0;

const MAX_GUESSES = 6;
const MATCH_EMOJI = { green: "🟩", yellow: "🟨", red: "🟥" };
const DIR_EMOJI = { up: "⬆️", down: "⬇️", match: "" };

async function getPrices() {
  const now = Date.now();
  if (now - lastPriceFetch > 60_000) {
    try {
      cachedPrices = await game.fetchAllPrices();
      lastPriceFetch = now;
    } catch (e) {
      console.error("Price fetch failed:", e.message);
    }
  }
  return cachedPrices;
}

function getSession(userId) {
  const dateStr = game.getTodayDateString();
  const key = `${userId}-${dateStr}`;
  return { key, dateStr, session: sessions.get(key) };
}

function createSession(userId) {
  const dateStr = game.getTodayDateString();
  const key = `${userId}-${dateStr}`;
  const secretIndex = game.getDailyCoinIndex(dateStr);
  const session = {
    secretIndex,
    guesses: [],
    gameOver: false,
    won: false,
  };
  sessions.set(key, session);
  return session;
}

// ── Format a guess result into a Discord embed ──
function buildGuessEmbed(result, guessNum, secret, isReveal) {
  const c = result.coin;
  const lines = [
    `**Type:** ${MATCH_EMOJI[result.type]} ${c.type}`,
    `**Color:** ${MATCH_EMOJI[result.color]} ${c.primaryColor}`,
    `**Year:** ${MATCH_EMOJI[result.launchYear]} ${c.launchYear} ${DIR_EMOJI[result.launchYearDir]}`,
    `**Ticker:** ${MATCH_EMOJI[result.tickerLength]} ${c.ticker} (${c.tickerLength}) ${DIR_EMOJI[result.tickerLengthDir]}`,
    `**Price:** ${MATCH_EMOJI[result.priceRange]} ${formatPrice(c.ticker)} ${DIR_EMOJI[result.priceRangeDir]}`,
    `**FDV:** ${MATCH_EMOJI[result.fdvRange]} ${c.fdvBucket} ${DIR_EMOJI[result.fdvRangeDir]}`,
  ];

  const embed = new EmbedBuilder()
    .setTitle(`Guess #${guessNum}: ${c.name} (${c.ticker})`)
    .setDescription(lines.join("\n"))
    .setColor(result.type === "green" && result.color === "green" ? 0x2d8c56 : 0x22262e);

  if (isReveal) {
    embed.setFooter({ text: `The answer was: ${secret.name} (${secret.ticker})` });
  }

  return embed;
}

function formatPrice(ticker) {
  const p = cachedPrices[ticker];
  if (!p) return "N/A";
  if (p.price >= 1) return `$${p.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${p.price.toPrecision(4)}`;
}

function buildBoardEmbed(session, puzzleNum) {
  const secret = game.COINS[session.secretIndex];
  const header = `📊 **Coindle #${puzzleNum}** — Guess ${session.guesses.length}/${MAX_GUESSES}`;

  if (session.guesses.length === 0) {
    return new EmbedBuilder()
      .setTitle(`Coindle #${puzzleNum}`)
      .setDescription("Use `/guess <coin>` to start guessing!\n\n6 categories: Type, Color, Year, Ticker Length, Price Range, FDV\n🟩 = correct  🟨 = close  🟥 = wrong\n⬆️ = go higher  ⬇️ = go lower")
      .setColor(0x5b8def);
  }

  const rows = session.guesses.map((r, i) => {
    const squares = [r.type, r.color, r.launchYear, r.tickerLength, r.priceRange, r.fdvRange]
      .map((m) => MATCH_EMOJI[m])
      .join("");
    return `\`${i + 1}.\` ${squares} **${r.coin.ticker}**`;
  });

  let footer = "";
  if (session.won) {
    footer = `\n\n🟢 **We Love Green Candles!** The answer was **${secret.name}**!`;
  } else if (session.gameOver) {
    footer = `\n\n🔻 **Dev Rugged.** The answer was **${secret.name}** (${secret.ticker})`;
  }

  return new EmbedBuilder()
    .setTitle(`Coindle #${puzzleNum}`)
    .setDescription(rows.join("\n") + footer)
    .setColor(session.won ? 0x2d8c56 : session.gameOver ? 0xf87171 : 0x5b8def)
    .setFooter({ text: session.gameOver ? "Come back tomorrow for a new puzzle!" : `${MAX_GUESSES - session.guesses.length} guesses remaining` });
}

function buildShareText(session, puzzleNum) {
  const rows = session.guesses.map((r) => {
    return [r.type, r.color, r.launchYear, r.tickerLength, r.priceRange, r.fdvRange]
      .map((m) => MATCH_EMOJI[m])
      .join("");
  });
  const result = session.won ? `${session.guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  return `Coindle #${puzzleNum} ${result}\n${rows.join("\n")}\nhttps://coindle.xyz`;
}

// ── Slash Command Handlers ──
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user } = interaction;

  if (commandName === "coindle") {
    const { session: existing } = getSession(user.id);
    const puzzleNum = game.getDailyPuzzleNumber();

    if (existing) {
      const embed = buildBoardEmbed(existing, puzzleNum);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const session = createSession(user.id);
    const embed = buildBoardEmbed(session, puzzleNum);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === "guess") {
    const input = interaction.options.getString("coin");
    const puzzleNum = game.getDailyPuzzleNumber();

    // Get or create session
    let { session } = getSession(user.id);
    if (!session) {
      session = createSession(user.id);
    }

    if (session.gameOver) {
      const embed = buildBoardEmbed(session, puzzleNum);
      return interaction.reply({
        content: session.won ? "You already got today's Coindle! 🟢" : "Today's Coindle is over. Come back tomorrow!",
        embeds: [embed],
        ephemeral: true,
      });
    }

    // Find the coin
    const coin = game.findCoin(input);
    if (!coin) {
      return interaction.reply({
        content: `❌ Couldn't find **"${input}"**. Try a ticker (BTC) or full name (Bitcoin).`,
        ephemeral: true,
      });
    }

    // Check for duplicate guess
    if (session.guesses.some((g) => g.coin.ticker === coin.ticker)) {
      return interaction.reply({
        content: `You already guessed **${coin.name}**! Try a different coin.`,
        ephemeral: true,
      });
    }

    // Fetch prices & compare
    const prices = await getPrices();
    const secret = game.COINS[session.secretIndex];
    const result = game.compareGuess(coin, secret, prices);
    session.guesses.push(result);

    // Check win/loss
    const allGreen = [result.type, result.color, result.launchYear, result.tickerLength, result.priceRange, result.fdvRange].every((m) => m === "green");

    if (allGreen) {
      session.won = true;
      session.gameOver = true;
    } else if (session.guesses.length >= MAX_GUESSES) {
      session.gameOver = true;
    }

    // Build response
    const guessEmbed = buildGuessEmbed(result, session.guesses.length, secret, session.gameOver && !session.won);
    const boardEmbed = buildBoardEmbed(session, puzzleNum);

    const response = { embeds: [guessEmbed, boardEmbed], ephemeral: true };

    // If game over, add shareable text
    if (session.gameOver) {
      const shareText = buildShareText(session, puzzleNum);
      response.content = `\`\`\`\n${shareText}\n\`\`\``;
    }

    return interaction.reply(response);
  }

  if (commandName === "coindle-status") {
    const { session } = getSession(user.id);
    const puzzleNum = game.getDailyPuzzleNumber();

    if (!session) {
      return interaction.reply({
        content: "You haven't started today's Coindle yet! Use `/coindle` to begin.",
        ephemeral: true,
      });
    }

    const embed = buildBoardEmbed(session, puzzleNum);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === "coindle-help") {
    const embed = new EmbedBuilder()
      .setTitle("How to Play Coindle")
      .setColor(0x5b8def)
      .setDescription(
        [
          "Guess the daily cryptocurrency in 6 tries!",
          "",
          "**Commands:**",
          "`/coindle` — Start today's puzzle",
          "`/guess <coin>` — Make a guess (ticker or name)",
          "`/coindle-status` — View your current board",
          "",
          "**6 Categories:**",
          "• **Type** — L1, L2, DeFi, Memecoin, etc.",
          "• **Color** — Logo primary color",
          "• **Year** — Launch year",
          "• **Ticker** — Ticker symbol length",
          "• **Price** — Current price range (via Pyth)",
          "• **FDV** — Fully diluted valuation range",
          "",
          "**Hints:**",
          "🟩 = Exact match",
          "🟨 = Close (adjacent tier/family)",
          "🟥 = Wrong",
          "⬆️ = Go higher  ⬇️ = Go lower",
          "",
          "New puzzle every day at midnight UTC!",
          "Play on web: **coindle.xyz**",
        ].join("\n")
      );

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

// ── Cleanup old sessions daily ──
setInterval(() => {
  const today = game.getTodayDateString();
  for (const [key] of sessions) {
    if (!key.endsWith(today)) sessions.delete(key);
  }
}, 60 * 60 * 1000); // every hour

client.once("ready", () => {
  console.log(`✓ Coindle bot online as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
