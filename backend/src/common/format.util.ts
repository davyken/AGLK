export function formatPrice(price: number): string {
  return price.toLocaleString() + ' XAF';
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function normalizeCommand(text: string): string {
  const upper = text.trim().toUpperCase();
  if (upper.startsWith('VENDRE')) return 'SELL' + upper.slice(6);
  if (upper.startsWith('ACHETER')) return 'BUY' + upper.slice(7);
  if (upper.startsWith('OFFRE')) return 'OFFER' + upper.slice(5);
  if (upper === 'OUI') return 'YES';
  if (upper === 'NON') return 'NO';
  if (upper === 'AIDE') return 'HELP';
  if (upper === 'SAUTER') return 'SKIP';
  return text.trim();
}

export function formatSmsMessage(message: string): string {
  return message
    .replace(/[\u{1F300}-\u{1FFFF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}]/gu, '')
    .replace(/\*/g, '')
    .trim();
}

export function formatMessage(
  channel: 'sms' | 'whatsapp',
  message: string,
): string {
  if (channel === 'sms') {
    return formatSmsMessage(message);
  }
  return message;
}
