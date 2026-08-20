import type { Locale } from './translations';

/**
 * Strings for manager messages ("Zpráva od manažera").
 *
 * Kept out of translations.ts on purpose: that file is one 1300-line literal
 * whose shape is derived from the English block, and threading a new section
 * through all four locales there is a merge-conflict machine. This module is
 * self-contained and typed the same way.
 */
export interface MessageStrings {
  kicker: string;
  counter: (index: number, total: number) => string;
  ack: string;
  acking: string;
  readFirst: string;
  showMore: string;
  contact: (who: string) => string;
  writtenInCzech: string;
  showIn: Record<Locale, string>;
  backToCzech: string;
  help: {
    title: string;
    empty: string;
    emptyHint: string;
    loading: string;
    fallbackNotice: string;
    updated: (date: string) => string;
    back: string;
  };
  newVersion: {
    message: string;
    action: string;
  };
  section: {
    navLabel: string;
    title: string;
    waiting: (n: number) => string;
    confirmedDivider: string;
    confirmedChip: string;
    confirmedAt: (date: string) => string;
    emptyTitle: string;
    emptyHint: string;
    forTeam: (n: number) => string;
    forProperty: (name: string) => string;
  };
  card: {
    swapToday: string;
    askOffice: string;
  };
  inbox: {
    title: string;
    tabAnnouncements: string;
    tabConversations: string;
    tabChanges: string;
    noAnnouncements: string;
    noConversations: string;
    noConversationsHint: string;
    noChanges: string;
    noChangesHint: string;
    oneWay: string;
  };
  thread: {
    participants: (n: number) => string;
    add: string;
    addTitle: string;
    addHint: string;
    cannotInvite: string;
    placeholder: string;
    send: string;
    sending: string;
    photo: string;
    opened: (property: string) => string;
    memberAdded: (actor: string, target: string) => string;
    startFirst: string;
    closed: string;
  };
  changes: {
    cancelled: string;
    guests: string;
    stay: string;
    modified: string;
    openTurnover: string;
    cancelledMeaning: string;
  };
  manager: {
    navLabel: string;
    title: string;
    subtitle: string;
    newMessage: string;
    targetLabel: string;
    targetHint: string;
    targetStaff: string;
    targetProperty: string;
    pickPeople: string;
    pickProperties: string;
    searchPeople: string;
    searchProperties: string;
    titleField: string;
    titlePlaceholder: string;
    bodyLabel: string;
    czechRequired: string;
    optional: string;
    validUntilField: string;
    validUntilHint: string;
    publish: string;
    publishing: string;
    cancel: string;
    acked: (acked: number, total: number) => string;
    awaitingRecipients: string;
    pendingLabel: string;
    allConfirmed: string;
    archive: string;
    archiveConfirm: string;
    empty: string;
    emptyHint: string;
    expiresOn: (date: string) => string;
    editedWarning: string;
    noPhoneWarning: string;
    phoneSectionHint: string;
    selectedCount: (n: number) => string;
    selectAll: string;
    clearAll: string;
    helpTitle: string;
    helpHint: string;
    helpUpload: string;
    helpUploading: string;
    helpImported: (locales: string) => string;
    helpNone: string;
    helpVersion: (version: number, date: string) => string;
    helpSize: (kb: number) => string;
  };
}

const en: MessageStrings = {
  kicker: 'Message from the manager',
  counter: (i, total) => `${i} of ${total}`,
  ack: 'Understood',
  acking: 'Saving…',
  readFirst: 'Read the message first',
  showMore: 'Show all',
  contact: (who) => `Message ${who}`,
  writtenInCzech: 'Written in Czech',
  showIn: {
    en: 'Show in English',
    cs: 'Zobrazit česky',
    ru: 'Показать по-русски',
    uk: 'Показати українською',
  },
  backToCzech: 'Back to Czech',
  help: {
    title: 'Help',
    empty: 'The manual has not been uploaded yet.',
    emptyHint: 'Your manager uploads it in Settings.',
    loading: 'Loading the manual…',
    fallbackNotice: 'Not available in your language yet — showing the Czech original.',
    updated: (date) => `Updated ${date}`,
    back: 'Back',
  },
  newVersion: {
    message: 'A new version of the app is available.',
    action: 'Reload',
  },
  section: {
    navLabel: 'Inbox',
    title: 'Alerts',
    waiting: (n) => `${n} waiting for confirmation`,
    confirmedDivider: 'Confirmed',
    confirmedChip: 'Confirmed',
    confirmedAt: (date) => `confirmed ${date}`,
    emptyTitle: 'No new messages',
    emptyHint: 'When your manager sends something, it shows up here.',
    forTeam: (n) => `For ${n} team members`,
    forProperty: (name) => `For ${name}`,
  },
  card: { swapToday: 'Turnaround today', askOffice: 'Message the office' },
  inbox: {
    title: 'Inbox & Notifications',
    tabAnnouncements: 'Announcements',
    tabConversations: 'Conversations',
    tabChanges: 'Changes',
    noAnnouncements: 'Nothing to confirm.',
    noConversations: 'No conversations yet.',
    noConversationsHint: 'Start one from a cleaning you have already begun.',
    noChanges: 'No changes.',
    noChangesHint: 'Changes to cleanings you are holding show up here.',
    oneWay: 'One-way announcement — you cannot reply',
  },
  thread: {
    participants: (n) => `${n} people`,
    add: 'Add',
    addTitle: 'Add to the channel',
    addHint: 'Everyone here works on cleanings.',
    cannotInvite: 'You can only add other cleaners. A manager is already here and can add anyone.',
    placeholder: 'Write a message…',
    send: 'Send',
    sending: 'Sending…',
    photo: 'Photo',
    opened: (property) => `Channel opened for ${property}`,
    memberAdded: (actor, target) => `${actor} added ${target}`,
    startFirst: 'Start the cleaning first',
    closed: 'This conversation is closed.',
  },
  changes: {
    cancelled: 'Booking cancelled',
    guests: 'Guest count changed',
    stay: 'Stay extended',
    modified: 'Booking changed',
    openTurnover: 'Open cleaning',
    cancelledMeaning: 'The cleaning is still yours and still needs doing — there is just no arrival deadline now.',
  },
  manager: {
    navLabel: 'Messages',
    title: 'Messages',
    subtitle: 'Short broadcasts the team has to confirm',
    newMessage: 'New message',
    targetLabel: 'Send to',
    targetHint: 'Either people or properties. Not both.',
    targetStaff: 'Specific people',
    targetProperty: 'Properties',
    pickPeople: 'People',
    pickProperties: 'Properties',
    searchPeople: 'Search people…',
    searchProperties: 'Search properties…',
    titleField: 'Subject',
    titlePlaceholder: 'New bed linen in the storage room',
    bodyLabel: 'Message',
    czechRequired: 'Czech — required',
    optional: 'optional',
    validUntilField: 'Show until',
    validUntilHint: 'Without an end date messages pile up and get tapped away unread.',
    publish: 'Publish',
    publishing: 'Publishing…',
    cancel: 'Cancel',
    acked: (acked, total) => `${acked} of ${total} confirmed`,
    awaitingRecipients: 'Nobody on these properties yet — waiting for a recipient',
    pendingLabel: 'Missing:',
    allConfirmed: 'Everyone confirmed',
    archive: 'Pull message',
    archiveConfirm: 'Remove this message from the cleaners’ screens?',
    empty: 'No active messages.',
    emptyHint: 'Published messages show up on top of the cleaners’ list until confirmed.',
    expiresOn: (date) => `until ${date}`,
    editedWarning: 'Editing the text invalidates confirmations — the message comes back to everyone.',
    noPhoneWarning: 'You have no mobile number saved, so cleaners cannot reach you on WhatsApp. Add it under Staff.',
    phoneSectionHint: 'The number cleaners reach you on from a message you published. International format, e.g. +420777123456.',
    selectedCount: (n) => `${n} selected`,
    selectAll: 'Select all',
    clearAll: 'Clear',
    helpTitle: 'Manual (Help)',
    helpHint: 'Upload the exported HTML. It is split by language and cleaners see it on their next open — no release needed.',
    helpUpload: 'Upload manual',
    helpUploading: 'Uploading…',
    helpImported: (locales) => `Imported: ${locales}`,
    helpNone: 'No manual uploaded yet.',
    helpVersion: (version, date) => `v${version} · ${date}`,
    helpSize: (kb) => `${kb} kB`,
  },
};

const cs: MessageStrings = {
  kicker: 'Zpráva od manažera',
  counter: (i, total) => `${i} z ${total}`,
  ack: 'Rozumím',
  acking: 'Ukládám…',
  readFirst: 'Nejdřív si zprávu přečtěte',
  showMore: 'Zobrazit vše',
  contact: (who) => `Napsat ${who}`,
  writtenInCzech: 'Napsáno česky',
  showIn: {
    en: 'Show in English',
    cs: 'Zobrazit česky',
    ru: 'Показать по-русски',
    uk: 'Показати українською',
  },
  backToCzech: 'Zpět na češtinu',
  help: {
    title: 'Nápověda',
    empty: 'Příručka zatím není nahraná.',
    emptyHint: 'Nahrává ji manažer v Nastavení.',
    loading: 'Načítám příručku…',
    fallbackNotice: 'Ve tvém jazyce zatím není — ukazujeme český originál.',
    updated: (date) => `Aktualizováno ${date}`,
    back: 'Zpět',
  },
  newVersion: {
    message: 'Je k dispozici nová verze aplikace.',
    action: 'Obnovit',
  },
  section: {
    navLabel: 'Inbox',
    title: 'Notifikace',
    waiting: (n) => `${n} ${n === 1 ? 'čeká' : n < 5 ? 'čekají' : 'čeká'} na potvrzení`,
    confirmedDivider: 'Potvrzené',
    confirmedChip: 'Potvrzeno',
    confirmedAt: (date) => `potvrzeno ${date}`,
    emptyTitle: 'Žádné nové zprávy',
    emptyHint: 'Když manažer něco pošle, uvidíte to tady.',
    forTeam: (n) => `Pro ${n} ${n === 1 ? 'člena' : n < 5 ? 'členy' : 'členů'} týmu`,
    forProperty: (name) => `Pro objekt ${name}`,
  },
  card: { swapToday: 'Výměna dnes', askOffice: 'Napsat na centrálu' },
  inbox: {
    title: 'Inbox & Notifications',
    tabAnnouncements: 'Oznámení',
    tabConversations: 'Konverzace',
    tabChanges: 'Změny',
    noAnnouncements: 'Nic k potvrzení.',
    noConversations: 'Zatím žádné konverzace.',
    noConversationsHint: 'Založíte ji u úklidu, který jste už zahájili.',
    noChanges: 'Žádné změny.',
    noChangesHint: 'Změny u úklidů, které máte vzaté, se ukážou tady.',
    oneWay: 'Jednosměrné oznámení — odpovídat nelze',
  },
  thread: {
    participants: (n) => `${n} ${n === 1 ? 'účastník' : n < 5 ? 'účastníci' : 'účastníků'}`,
    add: 'Přidat',
    addTitle: 'Přidat do kanálu',
    addHint: 'Všichni tady dělají úklidy.',
    cannotInvite: 'Můžete přidat jen další z úklidu. Manažer už v kanálu je a přidá kohokoli.',
    placeholder: 'Napsat zprávu…',
    send: 'Odeslat',
    sending: 'Odesílám…',
    photo: 'Fotka',
    opened: (property) => `Kanál otevřen u ${property}`,
    memberAdded: (actor, target) => `${actor} přidal(a) ${target}`,
    startFirst: 'Nejdřív úklid zahajte',
    closed: 'Tato konverzace je uzavřená.',
  },
  changes: {
    cancelled: 'Rezervace zrušena',
    guests: 'Změna počtu hostů',
    stay: 'Pobyt prodloužen',
    modified: 'Změna rezervace',
    openTurnover: 'Otevřít úklid',
    cancelledMeaning: 'Úklid zůstává váš a je pořád potřeba ho udělat — jen už na něj netlačí termín příjezdu.',
  },
  manager: {
    navLabel: 'Zprávy',
    title: 'Zprávy',
    subtitle: 'Krátká sdělení, která tým musí potvrdit',
    newMessage: 'Nová zpráva',
    targetLabel: 'Komu',
    targetHint: 'Buď lidem, nebo objektům. Obojí najednou nejde.',
    targetStaff: 'Konkrétní lidé',
    targetProperty: 'Objekty',
    pickPeople: 'Lidé',
    pickProperties: 'Objekty',
    searchPeople: 'Hledat lidi…',
    searchProperties: 'Hledat objekty…',
    titleField: 'Předmět',
    titlePlaceholder: 'Nová prostěradla ve skladu',
    bodyLabel: 'Text zprávy',
    czechRequired: 'Čeština — povinné',
    optional: 'volitelné',
    validUntilField: 'Zobrazovat do',
    validUntilHint: 'Bez data konce se zprávy nastřádají a lidi je začnou odklikávat bez čtení.',
    publish: 'Odeslat',
    publishing: 'Odesílám…',
    cancel: 'Zrušit',
    acked: (acked, total) => `${acked} z ${total} potvrdilo`,
    awaitingRecipients: 'Na těchto objektech zatím nikdo není — čeká na příjemce',
    pendingLabel: 'Chybí:',
    allConfirmed: 'Potvrdili všichni',
    archive: 'Stáhnout zprávu',
    archiveConfirm: 'Odebrat zprávu z obrazovek úklidového týmu?',
    empty: 'Žádné aktivní zprávy.',
    emptyHint: 'Odeslaná zpráva se ukáže nad seznamem úklidů, dokud ji člověk nepotvrdí.',
    expiresOn: (date) => `do ${date}`,
    editedWarning: 'Úpravou textu se zruší potvrzení a zpráva se vrátí všem.',
    noPhoneWarning: 'Nemáš uložené mobilní číslo, takže tě uklízečky nemůžou kontaktovat přes WhatsApp. Doplň ho v sekci Personál.',
    phoneSectionHint: 'Číslo, na které se ti uklízečky ozvou ze zprávy, kterou jsi odeslal. Mezinárodní tvar, např. +420777123456.',
    selectedCount: (n) => `${n} vybráno`,
    selectAll: 'Vybrat vše',
    clearAll: 'Zrušit výběr',
    helpTitle: 'Příručka (Nápověda)',
    helpHint: 'Nahraj vyexportované HTML. Rozdělí se po jazycích a uklízečky ho uvidí při dalším otevření — bez nasazení nové verze.',
    helpUpload: 'Nahrát příručku',
    helpUploading: 'Nahrávám…',
    helpImported: (locales) => `Nahráno: ${locales}`,
    helpNone: 'Příručka zatím není nahraná.',
    helpVersion: (version, date) => `v${version} · ${date}`,
    helpSize: (kb) => `${kb} kB`,
  },
};

const ru: MessageStrings = {
  kicker: 'Сообщение от менеджера',
  counter: (i, total) => `${i} из ${total}`,
  ack: 'Понятно',
  acking: 'Сохраняю…',
  readFirst: 'Сначала прочитайте сообщение',
  showMore: 'Показать полностью',
  contact: (who) => `Написать ${who}`,
  writtenInCzech: 'Написано по-чешски',
  showIn: {
    en: 'Show in English',
    cs: 'Zobrazit česky',
    ru: 'Показать по-русски',
    uk: 'Показати українською',
  },
  backToCzech: 'Вернуться к чешскому',
  help: {
    title: 'Справка',
    empty: 'Руководство ещё не загружено.',
    emptyHint: 'Его загружает менеджер в настройках.',
    loading: 'Загружаю руководство…',
    fallbackNotice: 'На вашем языке пока нет — показываем чешский оригинал.',
    updated: (date) => `Обновлено ${date}`,
    back: 'Назад',
  },
  newVersion: {
    message: 'Доступна новая версия приложения.',
    action: 'Обновить',
  },
  section: {
    navLabel: 'Inbox',
    title: 'Уведомления',
    waiting: (n) => `${n} ждёт подтверждения`,
    confirmedDivider: 'Подтверждённые',
    confirmedChip: 'Подтверждено',
    confirmedAt: (date) => `подтверждено ${date}`,
    emptyTitle: 'Новых сообщений нет',
    emptyHint: 'Когда менеджер что-то отправит, вы увидите это здесь.',
    forTeam: (n) => `Для ${n} сотрудников`,
    forProperty: (name) => `Для объекта ${name}`,
  },
  card: { swapToday: 'Смена сегодня', askOffice: 'Написать в офис' },
  inbox: {
    title: 'Inbox & Notifications',
    tabAnnouncements: 'Объявления',
    tabConversations: 'Переписка',
    tabChanges: 'Изменения',
    noAnnouncements: 'Подтверждать нечего.',
    noConversations: 'Переписок пока нет.',
    noConversationsHint: 'Начните её у уборки, которую вы уже начали.',
    noChanges: 'Изменений нет.',
    noChangesHint: 'Изменения по вашим уборкам появятся здесь.',
    oneWay: 'Одностороннее объявление — ответить нельзя',
  },
  thread: {
    participants: (n) => `${n} участн.`,
    add: 'Добавить',
    addTitle: 'Добавить в канал',
    addHint: 'Все здесь работают на уборках.',
    cannotInvite: 'Вы можете добавить только уборщиц. Менеджер уже здесь и может добавить любого.',
    placeholder: 'Написать сообщение…',
    send: 'Отправить',
    sending: 'Отправляю…',
    photo: 'Фото',
    opened: (property) => `Канал открыт для ${property}`,
    memberAdded: (actor, target) => `${actor} добавил(а) ${target}`,
    startFirst: 'Сначала начните уборку',
    closed: 'Переписка закрыта.',
  },
  changes: {
    cancelled: 'Бронь отменена',
    guests: 'Изменилось число гостей',
    stay: 'Проживание продлено',
    modified: 'Бронь изменена',
    openTurnover: 'Открыть уборку',
    cancelledMeaning: 'Уборка остаётся за вами, и её нужно сделать — просто больше нет срока к приезду.',
  },
  manager: {
    navLabel: 'Сообщения',
    title: 'Сообщения',
    subtitle: 'Короткие сообщения, которые команда должна подтвердить',
    newMessage: 'Новое сообщение',
    targetLabel: 'Кому',
    targetHint: 'Либо людям, либо объектам. Одновременно нельзя.',
    targetStaff: 'Конкретные люди',
    targetProperty: 'Объекты',
    pickPeople: 'Люди',
    pickProperties: 'Объекты',
    searchPeople: 'Поиск людей…',
    searchProperties: 'Поиск объектов…',
    titleField: 'Тема',
    titlePlaceholder: 'Новое постельное бельё на складе',
    bodyLabel: 'Текст сообщения',
    czechRequired: 'Чешский — обязательно',
    optional: 'необязательно',
    validUntilField: 'Показывать до',
    validUntilHint: 'Без даты окончания сообщения накапливаются, и их перестают читать.',
    publish: 'Отправить',
    publishing: 'Отправляю…',
    cancel: 'Отмена',
    acked: (acked, total) => `${acked} из ${total} подтвердили`,
    awaitingRecipients: 'На этих объектах пока никого нет — ждём получателя',
    pendingLabel: 'Не хватает:',
    allConfirmed: 'Подтвердили все',
    archive: 'Снять сообщение',
    archiveConfirm: 'Убрать сообщение с экранов команды?',
    empty: 'Нет активных сообщений.',
    emptyHint: 'Отправленное сообщение появится над списком уборок, пока его не подтвердят.',
    expiresOn: (date) => `до ${date}`,
    editedWarning: 'Изменение текста аннулирует подтверждения — сообщение вернётся ко всем.',
    noPhoneWarning: 'У вас не сохранён номер телефона, поэтому с вами нельзя связаться в WhatsApp. Добавьте его в разделе «Персонал».',
    phoneSectionHint: 'Номер, по которому с вами свяжутся из отправленного сообщения. Международный формат, напр. +420777123456.',
    selectedCount: (n) => `${n} выбрано`,
    selectAll: 'Выбрать всех',
    clearAll: 'Снять выбор',
    helpTitle: 'Руководство (Справка)',
    helpHint: 'Загрузите экспортированный HTML. Он разделится по языкам, и уборщицы увидят его при следующем открытии — без выпуска новой версии.',
    helpUpload: 'Загрузить руководство',
    helpUploading: 'Загружаю…',
    helpImported: (locales) => `Загружено: ${locales}`,
    helpNone: 'Руководство ещё не загружено.',
    helpVersion: (version, date) => `v${version} · ${date}`,
    helpSize: (kb) => `${kb} кБ`,
  },
};

const uk: MessageStrings = {
  kicker: 'Повідомлення від менеджера',
  counter: (i, total) => `${i} з ${total}`,
  ack: 'Зрозуміло',
  acking: 'Зберігаю…',
  readFirst: 'Спершу прочитайте повідомлення',
  showMore: 'Показати повністю',
  contact: (who) => `Написати ${who}`,
  writtenInCzech: 'Написано чеською',
  showIn: {
    en: 'Show in English',
    cs: 'Zobrazit česky',
    ru: 'Показать по-русски',
    uk: 'Показати українською',
  },
  backToCzech: 'Повернутися до чеської',
  help: {
    title: 'Довідка',
    empty: 'Посібник ще не завантажено.',
    emptyHint: 'Його завантажує менеджер у налаштуваннях.',
    loading: 'Завантажую посібник…',
    fallbackNotice: 'Вашою мовою поки немає — показуємо чеський оригінал.',
    updated: (date) => `Оновлено ${date}`,
    back: 'Назад',
  },
  newVersion: {
    message: 'Доступна нова версія застосунку.',
    action: 'Оновити',
  },
  section: {
    navLabel: 'Inbox',
    title: 'Сповіщення',
    waiting: (n) => `${n} чекає на підтвердження`,
    confirmedDivider: 'Підтверджені',
    confirmedChip: 'Підтверджено',
    confirmedAt: (date) => `підтверджено ${date}`,
    emptyTitle: 'Немає нових повідомлень',
    emptyHint: 'Коли менеджер щось надішле, ви побачите це тут.',
    forTeam: (n) => `Для ${n} працівників`,
    forProperty: (name) => `Для об'єкта ${name}`,
  },
  card: { swapToday: 'Заміна сьогодні', askOffice: 'Написати в офіс' },
  inbox: {
    title: 'Inbox & Notifications',
    tabAnnouncements: 'Оголошення',
    tabConversations: 'Листування',
    tabChanges: 'Зміни',
    noAnnouncements: 'Немає що підтверджувати.',
    noConversations: 'Листувань поки немає.',
    noConversationsHint: 'Почніть його на прибиранні, яке ви вже розпочали.',
    noChanges: 'Змін немає.',
    noChangesHint: 'Зміни у ваших прибираннях зʼявляться тут.',
    oneWay: 'Одностороннє оголошення — відповісти не можна',
  },
  thread: {
    participants: (n) => `${n} учасн.`,
    add: 'Додати',
    addTitle: 'Додати до каналу',
    addHint: 'Усі тут працюють на прибираннях.',
    cannotInvite: 'Ви можете додати лише інших прибиральниць. Менеджер уже тут і може додати будь-кого.',
    placeholder: 'Написати повідомлення…',
    send: 'Надіслати',
    sending: 'Надсилаю…',
    photo: 'Фото',
    opened: (property) => `Канал відкрито для ${property}`,
    memberAdded: (actor, target) => `${actor} додав(ла) ${target}`,
    startFirst: 'Спершу розпочніть прибирання',
    closed: 'Це листування закрите.',
  },
  changes: {
    cancelled: 'Бронювання скасовано',
    guests: 'Змінилася кількість гостей',
    stay: 'Перебування продовжено',
    modified: 'Бронювання змінено',
    openTurnover: 'Відкрити прибирання',
    cancelledMeaning: 'Прибирання залишається за вами і його треба зробити — просто немає терміну до приїзду.',
  },
  manager: {
    navLabel: 'Повідомлення',
    title: 'Повідомлення',
    subtitle: 'Короткі повідомлення, які команда має підтвердити',
    newMessage: 'Нове повідомлення',
    targetLabel: 'Кому',
    targetHint: "Або людям, або об'єктам. Одночасно не можна.",
    targetStaff: 'Конкретні люди',
    targetProperty: "Об'єкти",
    pickPeople: 'Люди',
    pickProperties: "Об'єкти",
    searchPeople: 'Пошук людей…',
    searchProperties: "Пошук об'єктів…",
    titleField: 'Тема',
    titlePlaceholder: 'Нова білизна на складі',
    bodyLabel: 'Текст повідомлення',
    czechRequired: "Чеська — обов'язково",
    optional: "необов'язково",
    validUntilField: 'Показувати до',
    validUntilHint: 'Без дати завершення повідомлення накопичуються, і їх перестають читати.',
    publish: 'Надіслати',
    publishing: 'Надсилаю…',
    cancel: 'Скасувати',
    acked: (acked, total) => `${acked} з ${total} підтвердили`,
    awaitingRecipients: "На цих об'єктах поки нікого немає — чекаємо на отримувача",
    pendingLabel: 'Бракує:',
    allConfirmed: 'Підтвердили всі',
    archive: 'Зняти повідомлення',
    archiveConfirm: 'Прибрати повідомлення з екранів команди?',
    empty: 'Немає активних повідомлень.',
    emptyHint: 'Надіслане повідомлення зʼявиться над списком прибирань, доки його не підтвердять.',
    expiresOn: (date) => `до ${date}`,
    editedWarning: 'Зміна тексту скасовує підтвердження — повідомлення повернеться до всіх.',
    noPhoneWarning: 'У вас не збережений номер телефону, тому з вами не можна звʼязатися у WhatsApp. Додайте його в розділі «Персонал».',
    phoneSectionHint: 'Номер, за яким з вами звʼяжуться з надісланого повідомлення. Міжнародний формат, напр. +420777123456.',
    selectedCount: (n) => `${n} вибрано`,
    selectAll: 'Вибрати всіх',
    clearAll: 'Зняти вибір',
    helpTitle: 'Посібник (Довідка)',
    helpHint: 'Завантажте експортований HTML. Він розділиться за мовами, і прибиральниці побачать його при наступному відкритті — без випуску нової версії.',
    helpUpload: 'Завантажити посібник',
    helpUploading: 'Завантажую…',
    helpImported: (locales) => `Завантажено: ${locales}`,
    helpNone: 'Посібник ще не завантажено.',
    helpVersion: (version, date) => `v${version} · ${date}`,
    helpSize: (kb) => `${kb} кБ`,
  },
};

export const messageStrings: Record<Locale, MessageStrings> = { en, cs, ru, uk };

export function useMessageStrings(locale: Locale): MessageStrings {
  return messageStrings[locale] ?? messageStrings.cs;
}
