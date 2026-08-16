export type CustomEmoji = {
  id: string;
  filename: string;
  src: string;
  alt: string;
  token: string;
};

const emojiFiles = [
  '_67.gif',
  '_ah.png',
  'aispin.gif',
  '_angel.png',
  'angel.png',
  'angryjoe.png',
  'angry_ping.gif',
  '_angry.png',
  'angry.png',
  'angryyygrr.png',
  '_astonish_tiktok.png',
  '_ayoo.png',
  '_ban.gif',
  '_blink_tiktok.png',
  '_browhat.png',
  '_catfingerguns.png',
  '_clockit.png',
  '_cool_tiktok.png',
  '_cornershaking.gif',
  '_cry.png',
  '_cute_tiktok.png',
  '_cynthiaerivo.png',
  '_droolface.png',
  'e_~1.png',
  '_embarrassed.png',
  'e_.png',
  '_evilcat.gif',
  '_evil_tiktok.png',
  '_excited_tiktok.png',
  '_fireheart.gif',
  '_flushed.png',
  '_foto.png',
  '_funnyface.png',
  '_happy.png',
  'head.png',
  '_hehehehehe.png',
  '_hehe_tiktok.png',
  '_lipbite.png',
  '_lovely.png',
  '_marryme.png',
  '_mikucinema.png',
  '_mimispank.gif',
  '_nonono.png',
  'number0.gif',
  'number1.gif',
  'number2.gif',
  '_panikemoji.png',
  '_paunched.png',
  '_perturbedsquidbob.png',
  '_proud.png',
  '_rage_tiktok.png',
  '_reze.gif',
  '_scribbleeyes.png',
  '_shock_tiktok.png',
  '_simplikesanji.gif',
  '_slap_tiktok.png',
  '_slay~1.png',
  '_slay.png',
  '_slimeface_tiktok.png',
  '_smug.png',
  '_spongebobishowspeedmeme.png',
  '_stun_tiktok.png',
  '_sus.png',
  '_sweating.png',
  '_tears_tiktok.png',
  '_unlimitedvoidexp.png',
  '_verey_angery.gif',
  '_whatever.png',
  '_wow_tiktok.png',
  'emojis2/angel.gif',
  'emojis2/blank.gif',
  'emojis2/blush.gif',
  'emojis2/confused.gif',
  'emojis2/cool.gif',
  'emojis2/devil.gif',
  'emojis2/duh.gif',
  'emojis2/flower.gif',
  'emojis2/grin.gif',
  'emojis2/shocked.gif',
  'emojis2/smile.gif',
  'emojis2/smiley.gif',
] as const;

function emojiId(filename: string) {
  return filename.replace(/\.[^/.]+$/, '').replace(/\//g, '-');
}

function emojiAlt(filename: string) {
  return filename.split('/').pop()?.replace(/\.[^/.]+$/, '').replace(/^_/, '').replace(/[_~]+/g, ' ').trim() || 'emoji personalizado';
}

export const CUSTOM_EMOJIS: CustomEmoji[] = emojiFiles.map((filename) => {
  const id = emojiId(filename);
  return {
    id,
    filename,
    src: `/emojis/${filename}`,
    alt: emojiAlt(filename),
    token: `[[emoji:${id}]]`,
  };
});

export const CUSTOM_EMOJI_BY_ID = new Map(CUSTOM_EMOJIS.map((emoji) => [emoji.id, emoji]));
export const CUSTOM_EMOJI_TOKEN_PATTERN = /\[\[emoji:([^\]\s]+)\]\]/g;

export function customEmojiToken(id: string) {
  return `[[emoji:${id}]]`;
}

const EMOJI_COMMANDS: Array<{ command: string; emojiId: string }> = [
  { command: '(a)', emojiId: 'emojis2-angel' },
  { command: ':|', emojiId: 'emojis2-blank' },
  { command: ':$', emojiId: 'emojis2-blush' },
  { command: ':s', emojiId: 'emojis2-confused' },
  { command: '(h)', emojiId: 'emojis2-cool' },
  { command: '(6)', emojiId: 'emojis2-devil' },
  { command: '(pz)', emojiId: 'emojis2-duh' },
  { command: '(f)', emojiId: 'emojis2-flower' },
  { command: ':d', emojiId: 'emojis2-grin' },
  { command: ':o', emojiId: 'emojis2-shocked' },
  { command: ':)', emojiId: 'emojis2-smile' },
  { command: ':]', emojiId: 'emojis2-smiley' },
];

const escapedEmojiCommands = EMOJI_COMMANDS
  .map(({ command }) => command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .sort((left, right) => right.length - left.length)
  .join('|');
const EMOJI_COMMAND_PATTERN = new RegExp(escapedEmojiCommands, 'gi');
const EMOJI_COMMAND_BY_VALUE = new Map(EMOJI_COMMANDS.map(({ command, emojiId }) => [command.toLowerCase(), emojiId]));

/** Convierte los comandos clásicos en tokens persistentes para cualquier tipo de cuenta. */
export function replaceEmojiCommands(value: string) {
  return value.replace(EMOJI_COMMAND_PATTERN, (match) => {
    const emojiId = EMOJI_COMMAND_BY_VALUE.get(match.toLowerCase());
    return emojiId ? customEmojiToken(emojiId) : match;
  });
}