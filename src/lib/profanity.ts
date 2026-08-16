const OFFENSIVE_WORDS = new Set([
  'asshole', 'assholes', 'bastard', 'bastards', 'bitch', 'bitches', 'bullshit',
  'cock', 'cocks', 'crap', 'cunt', 'cunts', 'dick', 'dicks', 'dickhead',
  'dumbass', 'fuck', 'fucked', 'fucker', 'fuckers', 'fucking', 'motherfucker',
  'piss', 'pussy', 'shit', 'shits', 'slut', 'sluts', 'stfu', 'whore', 'whores',
  'cabron', 'cabrona', 'cabrones', 'chingada', 'chingado', 'chingar', 'chingas',
  'chinga', 'chingue', 'chinguen', 'cojones', 'coño', 'culero', 'culera',
  'culeros', 'culo', 'joto', 'jotos', 'mamada', 'mamadas', 'mamon', 'marica',
  'maricon', 'mierda', 'naco', 'nacos', 'pajero', 'pajera', 'pendeja',
  'pendejas', 'pendejo', 'pendejos', 'perra', 'perras', 'pinche', 'pinches',
  'puta', 'putas', 'puto', 'putos', 'verga', 'vergazos', 'zorra', 'zorras',
  'nigga', 'nigger', 'spic', 'wetback',
]);

function normalizeForProfanity(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's');
}

/**
 * Sustituye cada palabra ofensiva por exactamente cuatro asteriscos.
 * Se conserva la puntuación y los espacios para no deformar el mensaje.
 */
export function censorProfanity(value: string) {
  return value.replace(/[A-Za-zÀ-ÖØ-öø-ÿ0-9@$]+/g, (word) => (
    OFFENSIVE_WORDS.has(normalizeForProfanity(word)) ? '****' : word
  ));
}