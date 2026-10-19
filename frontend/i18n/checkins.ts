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
  // ── Detail & report ──
  back: string;
  guest: string;
  call: string;
  noPhone: string;
  arrival: string;
  guests: string;
  crib: string;
  separateBeds: string;
  reportTitle: string;
  reportComment: string;
  readiness: string;
  aspect: Record<'CLEANLINESS', string>;
  lowNeedsComment: string;
  whatWasWrong: string;
  saveReport: string;
  updateReport: string;
  reportSaved: string;
  reportFromArrivalDay: string;
  reportClosed: string;
  reportMissing: string;
  reported: string;
  acceptFirst: string;
  earlier: string;
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
    back: 'Back',
    guest: 'Guest',
    call: 'Call',
    noPhone: 'No phone number in the booking',
    arrival: 'Arrival',
    guests: 'Guests',
    crib: 'Crib',
    separateBeds: 'Separate beds',
    reportTitle: 'How did the check-in go?',
    reportComment: 'Anything the office should know (optional)',
    readiness: 'Apartment readiness',
    aspect: { CLEANLINESS: 'Cleanliness' },
    lowNeedsComment: 'Below 3 — please say what was wrong',
    whatWasWrong: 'What was wrong?',
    saveReport: 'Send report',
    updateReport: 'Save changes',
    reportSaved: 'Report saved',
    reportFromArrivalDay: 'You can write the report on the arrival day.',
    reportClosed: 'This check-in is too old to report on.',
    reportMissing: 'Report missing',
    reported: 'Report sent',
    acceptFirst: 'Accept the check-in first.',
    earlier: 'Earlier',
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
    back: 'Zpět',
    guest: 'Host',
    call: 'Zavolat',
    noPhone: 'V rezervaci není telefon',
    arrival: 'Příjezd',
    guests: 'Hosté',
    crib: 'Postýlka',
    separateBeds: 'Oddělené postele',
    reportTitle: 'Jak proběhl check-in?',
    reportComment: 'Co by měla kancelář vědět (nepovinné)',
    readiness: 'Připravenost apartmánu',
    aspect: { CLEANLINESS: 'Čistota' },
    lowNeedsComment: 'Pod 3 — napiš prosím, co bylo špatně',
    whatWasWrong: 'Co bylo špatně?',
    saveReport: 'Odeslat report',
    updateReport: 'Uložit změny',
    reportSaved: 'Report uložen',
    reportFromArrivalDay: 'Report můžeš napsat v den příjezdu.',
    reportClosed: 'Tento check-in je už příliš starý na report.',
    reportMissing: 'Chybí report',
    reported: 'Report odeslán',
    acceptFirst: 'Nejdřív check-in přijmi.',
    earlier: 'Dříve',
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
    back: 'Назад',
    guest: 'Гость',
    call: 'Позвонить',
    noPhone: 'В бронировании нет телефона',
    arrival: 'Заезд',
    guests: 'Гости',
    crib: 'Детская кроватка',
    separateBeds: 'Раздельные кровати',
    reportTitle: 'Как прошло заселение?',
    reportComment: 'Что стоит знать офису (необязательно)',
    readiness: 'Готовность апартаментов',
    aspect: { CLEANLINESS: 'Чистота' },
    lowNeedsComment: 'Ниже 3 — опишите, что было не так',
    whatWasWrong: 'Что было не так?',
    saveReport: 'Отправить отчёт',
    updateReport: 'Сохранить изменения',
    reportSaved: 'Отчёт сохранён',
    reportFromArrivalDay: 'Отчёт можно написать в день заезда.',
    reportClosed: 'Это заселение слишком старое для отчёта.',
    reportMissing: 'Нет отчёта',
    reported: 'Отчёт отправлен',
    acceptFirst: 'Сначала примите заселение.',
    earlier: 'Ранее',
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
    back: 'Назад',
    guest: 'Гість',
    call: 'Зателефонувати',
    noPhone: 'У бронюванні немає телефону',
    arrival: 'Заїзд',
    guests: 'Гості',
    crib: 'Дитяче ліжечко',
    separateBeds: 'Окремі ліжка',
    reportTitle: 'Як пройшло заселення?',
    reportComment: 'Що варто знати офісу (необовʼязково)',
    readiness: 'Готовність апартаментів',
    aspect: { CLEANLINESS: 'Чистота' },
    lowNeedsComment: 'Нижче 3 — опишіть, що було не так',
    whatWasWrong: 'Що було не так?',
    saveReport: 'Надіслати звіт',
    updateReport: 'Зберегти зміни',
    reportSaved: 'Звіт збережено',
    reportFromArrivalDay: 'Звіт можна написати в день заїзду.',
    reportClosed: 'Це заселення занадто старе для звіту.',
    reportMissing: 'Немає звіту',
    reported: 'Звіт надіслано',
    acceptFirst: 'Спочатку прийміть заселення.',
    earlier: 'Раніше',
  },
};

export function useCheckInStrings(locale: Locale): CheckInStrings {
  return strings[locale] ?? strings.en;
}
