/** "Francouzská 15, unit F4 - Praha 2" → "Francouzská 15" */
export const street = (name: string) => name.split(',')[0].split(' - ')[0].trim();
