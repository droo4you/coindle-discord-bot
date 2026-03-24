require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("coindle")
    .setDescription("Start today's Coindle puzzle"),
  new SlashCommandBuilder()
    .setName("guess")
    .setDescription("Guess a cryptocurrency")
    .addStringOption((opt) =>
      opt.setName("coin").setDescription("Coin name or ticker (e.g. BTC, Ethereum)").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("coindle-status")
    .setDescription("View your current game progress"),
  new SlashCommandBuilder()
    .setName("coindle-help")
    .setDescription("Learn how to play Coindle"),
].map((cmd) => cmd.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("✓ Slash commands registered globally");
  } catch (err) {
    console.error(err);
  }
})();
