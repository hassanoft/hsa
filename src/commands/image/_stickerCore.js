// Fichier partagé (pas une commande) : logique commune à /sticker et /s.
import fs from 'node:fs';
import ffmpeg from 'fluent-ffmpeg';
import { resolveFfmpegPath, tempFilePath, cleanupFile, ffmpegRun } from '../../utils/media.js';
import { downloadQuotedOrDirectMedia } from '../../utils/media.js';
import { errorMessage } from '../../utils/formatter.js';

export async function convertToSticker(bufferIn, isAnimated) {
  await resolveFfmpegPath();
  const inExt = isAnimated ? 'mp4' : 'png';
  const inFile = tempFilePath(inExt);
  const outFile = tempFilePath('webp');
  fs.writeFileSync(inFile, bufferIn);

  try {
    const cmd = ffmpeg(inFile);
    if (isAnimated) {
      cmd.outputOptions([
        '-vcodec', 'libwebp',
        '-vf', "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000",
        '-loop', '0',
        '-preset', 'default',
        '-an',
        '-vsync', '0',
        '-t', '8',
      ]);
    } else {
      cmd.outputOptions([
        '-vcodec', 'libwebp',
        '-vf', "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000",
      ]);
    }
    cmd.save(outFile);
    await ffmpegRun(cmd);
    return fs.readFileSync(outFile);
  } finally {
    cleanupFile(inFile);
    cleanupFile(outFile);
  }
}

export async function handleStickerCommand(ctx) {
  const media = await downloadQuotedOrDirectMedia(ctx.msg);
  if (!media || !['image', 'video', 'sticker'].includes(media.type)) {
    await ctx.reply(`❌ Répondez à une image ou une courte vidéo avec ${ctx.prefix}sticker.`);
    return;
  }
  const isAnimated = media.type === 'video';
  try {
    const webp = await convertToSticker(media.buffer, isAnimated);
    await ctx.sock.sendMessage(ctx.chatId, { sticker: webp }, { quoted: ctx.msg });
  } catch (err) {
    await ctx.reply(errorMessage('Échec de la conversion en sticker (ffmpeg manquant ou média invalide).'));
  }
}
