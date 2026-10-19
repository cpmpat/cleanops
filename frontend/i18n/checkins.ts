import type { Locale } from './translations';

/** Strings for the agent's Check-ins tab. One typed module per feature, like availability.ts. */
export interface CheckInStrings {
  navLabel: string;
  title: string;
  subtitle: string;
  needsAnswer: string;
  gained: string;
  lost: string;
  overrideAsk: string;
  accept: string;
  decline: string;
  gotIt: string;
  timeNotConfirmed: string;
  openChekin: string;
  nothing: string;
  replaced: string;
  awaiting: string;
  today: string;
  tomorrow: string;
}

const strings: Record<Locale, CheckInStrings> = {
  en: {
    navLabel: 'Check-ins',
    title: 'My check-ins',
    subtitle: 'Guests you meet. Changes from the desk appear at the top.',
    needsAnswer: 'Waiting for your answer',
    gained: 'New check-in for you',
    lost: 'No longer yours',
    overrideAsk: 'You had not marked yourself available for this arrival. Can you take it?',
    accept: "I'll take it",
    decline: "I can't",
    gotIt: 'Got it',
    timeNotConfirmed: 'time not confirmed',
    openChekin: 'Guest registration (Chekin)',
    nothing: 'No check-ins assigned to you yet.',
    replaced: 'This changed again in the meantime — refreshed.',
    awaiting: 'Waiting for your yes',
    today: 'Today',
    tomorrow: 'Tomorrow',
  },
  cs: {
    navLabel: 'Check-iny',
    title: 'Moje check-iny',
    subtitle: 'Hosté, které předáváš. Změny od recepce jsou nahoře.',
    needsAnswer: 'Čeká na tvou odpověď',
    gained: 'Nový check-in pro tebe',
    lost: 'Už není tvůj',
    overrideAsk: 'Na tento příjezd jsi neměl(a) zadanou dostupnost. Zvládneš ho?',
    accept: 'Beru',
    decline: 'Nemůžu',
    gotIt: 'Rozumím',
    timeNotConfirmed: 'čas nepotvrzen',
    openChekin: 'Registrace hosta (Chekin)',
    nothing: 'Zatím nemáš přiřazené žádné check-iny.',
    replaced: 'Mezitím se to znovu změnilo — načteno znovu.',
    awaiting: 'Čeká na tvé ano',
    today: 'Dnes',
    tomorrow: 'Zítra',
  },
  ru: {
    navLabel: 'Заселения',
    title: 'Мои заселения',
    subtitle: 'Гости, которых вы встречаете. Изменения от ресепшена — вверху.',
    needsAnswer: 'Ждёт вашего ответа',
    gained: 'Новое заселение для вас',
    lost: 'Больше не ваше',
    overrideAsk: 'Вы не отметили доступность на это время. Сможете взять?',
    accept: 'Беру',
    decline: 'Не могу',
    gotIt: 'Понятно',
    timeNotConfirmed: 'время не подтверждено',
    openChekin: 'Регистрация гостя (Chekin)',
    nothing: 'Пока нет назначенных вам заселений.',
    replaced: 'Это уже изменилось — обновлено.',
    awaiting: 'Ждёт вашего «да»',
    today: 'Сегодня',
    tomorrow: 'Завтра',
  },
  uk: {
    navLabel: 'Заселення',
    title: 'Мої заселення',
    subtitle: 'Гості, яких ви зустрічаєте. Зміни від рецепції — вгорі.',
    needsAnswer: 'Чекає на вашу відповідь',
    gained: 'Нове заселення для вас',
    lost: 'Більше не ваше',
    overrideAsk: 'Ви не позначили доступність на цей час. Зможете взяти?',
    accept: 'Беру',
    decline: 'Не можу',
    gotIt: 'Зрозуміло',
    timeNotConfirmed: 'час не підтверджено',
    openChekin: 'Реєстрація гостя (Chekin)',
    nothing: 'Поки немає призначених вам заселень.',
    replaced: 'Це вже змінилося — оновлено.',
    awaiting: 'Чекає на ваше «так»',
    today: 'Сьогодні',
    tomorrow: 'Завтра',
  },
};

export function useCheckInStrings(locale: Locale): CheckInStrings {
  return strings[locale] ?? strings.en;
}
