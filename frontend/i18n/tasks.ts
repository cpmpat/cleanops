import type { Locale } from './translations';

/** Strings for the Tasks module (16 Oct 2026). One typed module per feature, as messages.ts. */
export interface TaskStrings {
  navLabel: string;
  title: string;
  subtitle: string;
  newTask: string;
  create: string;
  cancel: string;
  save: string;
  edit: string;
  stage: Record<'NEW' | 'TODO' | 'IN_PROGRESS' | 'ON_HOLD' | 'REVIEW' | 'DONE', string>;
  stageHint: Record<'NEW' | 'TODO' | 'IN_PROGRESS' | 'ON_HOLD' | 'REVIEW' | 'DONE', string>;
  priority: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT', string>;
  filterAll: string;
  filterOnMe: string;
  filterWatching: string;
  search: string;
  everyone: string;
  waitingOn: string;
  onYou: string;
  overdue: string;
  noTasks: string;
  showOlderDone: (days: number) => string;
  fieldTitle: string;
  fieldDescription: string;
  fieldAssignees: string;
  fieldPriority: string;
  fieldDue: string;
  fieldStage: string;
  fieldCreatedBy: string;
  fieldWatchers: string;
  fieldHoldReason: string;
  holdReasonPlaceholder: string;
  startAs: string;
  watch: string;
  watching: string;
  nowOn: string;
  reason: Record<'waiting' | 'review' | 'triage' | 'assigned' | 'none', string>;
  nobody: string;
  askSomeone: string;
  clear: string;
  thread: string;
  replyPlaceholder: string;
  /** Checkbox under the reply, one per tagged person; unticked by default. */
  putOn: (name: string) => string;
  putOnHint: string;
  responsible: string;
  fieldRecords: string;
  linkRecord: string;
  pickTable: string;
  pickRecord: string;
  pickField: string;
  wholeRecord: string;
  addLink: string;
  restricted: string;
  noRecords: string;
  needsAssignee: string;
  lastAssignee: string;
  send: string;
  closeDone: string;
  closeWontDo: string;
  reopen: string;
  closedAs: (how: string, who: string) => string;
  wontDo: string;
  sendToReview: string;
  notifications: string;
  markAllRead: string;
  noNotifications: string;
  notif: Record<string, (actor: string, text: string) => string>;
  event: {
    created: string;
    moved: (from: string, to: string) => string;
    assigned: (added: string, removed: string) => string;
    closed: (how: string) => string;
    reopened: string;
    edited: (fields: string) => string;
    waiting: (who: string) => string;
    wait_cleared: (who: string) => string;
    linked: (what: string) => string;
    unlinked: (what: string) => string;
  };
  waitSince: (who: string, ago: string) => string;
  onlyManagersClose: string;
  dragNotAllowed: string;
  shortcutHint: string;
}

const en: TaskStrings = {
  navLabel: 'Tasks',
  title: 'Tasks',
  subtitle: 'Who owns what, and on whom each task is waiting.',
  newTask: 'New task',
  create: 'Create task',
  cancel: 'Cancel',
  save: 'Save',
  edit: 'Edit',
  stage: { NEW: 'New', TODO: 'To do', IN_PROGRESS: 'In progress', ON_HOLD: 'On hold', REVIEW: 'Review', DONE: 'Done' },
  stageHint: {
    NEW: 'Not yet accepted',
    TODO: 'Accepted, not started',
    IN_PROGRESS: 'Being worked on',
    ON_HOLD: 'Blocked or parked',
    REVIEW: 'Finished — the creator decides',
    DONE: 'Closed by the creator',
  },
  priority: { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' },
  filterAll: 'All',
  filterOnMe: 'On me',
  filterWatching: 'Watching',
  search: 'Filter tasks…',
  everyone: 'Everyone',
  waitingOn: 'Waiting on',
  onYou: 'On you',
  overdue: 'Overdue',
  noTasks: 'No tasks',
  showOlderDone: (d) => `Done shows the last ${d} days. Show all`,
  fieldTitle: 'Title',
  fieldDescription: 'Description',
  fieldAssignees: 'Assignees',
  fieldPriority: 'Priority',
  fieldDue: 'Due date',
  fieldStage: 'Stage',
  fieldCreatedBy: 'Created by',
  fieldWatchers: 'Watchers',
  fieldHoldReason: 'Why on hold',
  holdReasonPlaceholder: 'Owner, supplier, a date…',
  startAs: 'Start in',
  watch: 'Watch',
  watching: 'Watching',
  nowOn: 'Now on',
  reason: {
    waiting: 'waiting for a reply',
    review: 'to review and close',
    triage: 'to accept and assign',
    assigned: 'assigned',
    none: '',
  },
  nobody: 'Nobody',
  askSomeone: 'Waiting on someone…',
  clear: 'Clear',
  thread: 'Thread',
  replyPlaceholder: 'Write a reply… type @ to tag someone',
  putOn: (n) => `Put the task on ${n} until they reply`,
  putOnHint: 'Tagging only notifies. Tick to make it their turn.',
  responsible: 'Responsible',
  fieldRecords: 'Related records',
  linkRecord: 'Link a record',
  pickTable: 'Table',
  pickRecord: 'Search a record…',
  pickField: 'Attribute (optional)',
  wholeRecord: 'Whole record',
  addLink: 'Add',
  restricted: 'Restricted record',
  noRecords: 'No records found',
  needsAssignee: 'Assign someone first — an active task always needs a responsible person.',
  lastAssignee: 'Someone must stay responsible while the task is active. Add the new assignee before removing the last one.',
  send: 'Send',
  closeDone: 'Close as done',
  closeWontDo: "Close as won't do",
  reopen: 'Reopen',
  closedAs: (how, who) => `Closed as ${how} by ${who}`,
  wontDo: "won't do",
  sendToReview: 'Suggest closing',
  notifications: 'Notifications',
  markAllRead: 'Mark all as read',
  noNotifications: 'Nothing new.',
  notif: {
    assigned: (a) => `${a} assigned you`,
    mention: (a, t) => `${a} tagged you: “${t}”`,
    comment: (a, t) => `${a} replied: “${t}”`,
    status: (a, t) => `${a} moved it to ${t}`,
    closed: (a) => `${a} closed it`,
    reopened: (a) => `${a} reopened it`,
    waiting: (a, t) => `${a} is waiting on you${t ? `: “${t}”` : ''}`,
    edited: (a) => `${a} changed priority or due date`,
    suggest_close: (a) => `${a} suggests closing it`,
  },
  event: {
    created: 'created the task',
    moved: (f, t) => `moved it from ${f} to ${t}`,
    assigned: (a, r) => [a && `assigned ${a}`, r && `unassigned ${r}`].filter(Boolean).join(', '),
    closed: (how) => `closed it as ${how}`,
    reopened: 'reopened it',
    edited: (f) => `edited ${f}`,
    waiting: (w) => `is waiting on ${w}`,
    wait_cleared: (w) => `stopped waiting on ${w}`,
    linked: (w) => `linked ${w}`,
    unlinked: (w) => `unlinked ${w}`,
  },
  waitSince: (w, ago) => `${w} · ${ago}`,
  onlyManagersClose: "Only the task's creator can close or reopen it. Move it to Review to suggest closing.",
  dragNotAllowed: 'Only the assignees or a manager can move this task.',
  shortcutHint: 'N — new task',
};

const cs: TaskStrings = {
  ...en,
  navLabel: 'Úkoly',
  title: 'Úkoly',
  subtitle: 'Kdo co vlastní a na kom který úkol visí.',
  newTask: 'Nový úkol',
  create: 'Vytvořit úkol',
  cancel: 'Zrušit',
  save: 'Uložit',
  edit: 'Upravit',
  stage: { NEW: 'Nové', TODO: 'K řešení', IN_PROGRESS: 'Probíhá', ON_HOLD: 'Pozastaveno', REVIEW: 'Ke kontrole', DONE: 'Hotovo' },
  stageHint: {
    NEW: 'Zatím nepřijato',
    TODO: 'Přijato, nezahájeno',
    IN_PROGRESS: 'Pracuje se na tom',
    ON_HOLD: 'Blokováno nebo odloženo',
    REVIEW: 'Hotovo — rozhodne zakladatel',
    DONE: 'Uzavřel zakladatel',
  },
  priority: { LOW: 'Nízká', MEDIUM: 'Střední', HIGH: 'Vysoká', URGENT: 'Urgentní' },
  filterAll: 'Vše',
  filterOnMe: 'Na mně',
  filterWatching: 'Sleduji',
  search: 'Filtrovat úkoly…',
  everyone: 'Všichni',
  waitingOn: 'Čeká na',
  onYou: 'Na vás',
  overdue: 'Po termínu',
  noTasks: 'Žádné úkoly',
  showOlderDone: (d) => `Hotovo ukazuje posledních ${d} dní. Zobrazit vše`,
  fieldTitle: 'Název',
  fieldDescription: 'Popis',
  fieldAssignees: 'Řešitelé',
  fieldPriority: 'Priorita',
  fieldDue: 'Termín',
  fieldStage: 'Fáze',
  fieldCreatedBy: 'Vytvořil',
  fieldWatchers: 'Sledující',
  fieldHoldReason: 'Proč pozastaveno',
  holdReasonPlaceholder: 'Majitel, dodavatel, datum…',
  startAs: 'Začít v',
  watch: 'Sledovat',
  watching: 'Sleduji',
  nowOn: 'Teď na',
  reason: { waiting: 'čeká na odpověď', review: 'zkontrolovat a uzavřít', triage: 'přijmout a přidělit', assigned: 'přiděleno', none: '' },
  nobody: 'Nikdo',
  askSomeone: 'Čeká se na…',
  clear: 'Zrušit',
  thread: 'Vlákno',
  replyPlaceholder: 'Napište odpověď… @ označí kolegu',
  putOn: (n) => `Úkol čeká na ${n}, dokud neodpoví`,
  putOnHint: 'Označení jen upozorní. Zaškrtněte, pokud je na tahu.',
  responsible: 'Odpovídá',
  fieldRecords: 'Související záznamy',
  linkRecord: 'Připojit záznam',
  pickTable: 'Tabulka',
  pickRecord: 'Hledat záznam…',
  pickField: 'Atribut (nepovinné)',
  wholeRecord: 'Celý záznam',
  addLink: 'Přidat',
  restricted: 'Skrytý záznam',
  noRecords: 'Nic nenalezeno',
  needsAssignee: 'Nejdřív někoho přidělte — aktivní úkol musí mít odpovědnou osobu.',
  lastAssignee: 'Aktivní úkol musí mít odpovědnou osobu. Nejdřív přidejte nového řešitele, pak odeberte posledního.',
  send: 'Odeslat',
  closeDone: 'Uzavřít jako hotové',
  closeWontDo: 'Uzavřít jako neřešit',
  reopen: 'Znovu otevřít',
  closedAs: (how, who) => `Uzavřeno (${how}) — ${who}`,
  wontDo: 'neřešit',
  sendToReview: 'Navrhnout uzavření',
  notifications: 'Notifikace',
  markAllRead: 'Označit vše jako přečtené',
  noNotifications: 'Nic nového.',
  notif: {
    assigned: (a) => `${a} vám přidělil úkol`,
    mention: (a, t) => `${a} vás označil: „${t}“`,
    comment: (a, t) => `${a} odpověděl: „${t}“`,
    status: (a, t) => `${a} přesunul úkol do ${t}`,
    closed: (a) => `${a} úkol uzavřel`,
    reopened: (a) => `${a} úkol znovu otevřel`,
    waiting: (a, t) => `${a} čeká na vás${t ? `: „${t}“` : ''}`,
    edited: (a) => `${a} změnil prioritu nebo termín`,
    suggest_close: (a) => `${a} navrhuje úkol uzavřít`,
  },
  event: {
    created: 'vytvořil úkol',
    moved: (f, t) => `přesunul z ${f} do ${t}`,
    assigned: (a, r) => [a && `přidělil ${a}`, r && `odebral ${r}`].filter(Boolean).join(', '),
    closed: (how) => `uzavřel (${how})`,
    reopened: 'znovu otevřel',
    edited: (f) => `upravil ${f}`,
    waiting: (w) => `čeká na ${w}`,
    wait_cleared: (w) => `už nečeká na ${w}`,
    linked: (w) => `připojil ${w}`,
    unlinked: (w) => `odpojil ${w}`,
  },
  onlyManagersClose: "Uzavřít nebo znovu otevřít úkol může jen jeho zakladatel. Přesunem do Ke kontrole navrhnete uzavření.",
  dragNotAllowed: 'Úkol mohou přesouvat jen řešitelé nebo manažer.',
  shortcutHint: 'N — nový úkol',
};

const ru: TaskStrings = {
  ...en,
  navLabel: 'Задачи',
  title: 'Задачи',
  subtitle: 'Кто за что отвечает и на ком висит каждая задача.',
  newTask: 'Новая задача',
  create: 'Создать задачу',
  cancel: 'Отмена',
  save: 'Сохранить',
  edit: 'Изменить',
  stage: { NEW: 'Новые', TODO: 'К выполнению', IN_PROGRESS: 'В работе', ON_HOLD: 'Отложено', REVIEW: 'На проверке', DONE: 'Готово' },
  stageHint: {
    NEW: 'Ещё не принято',
    TODO: 'Принято, не начато',
    IN_PROGRESS: 'В работе',
    ON_HOLD: 'Заблокировано или отложено',
    REVIEW: 'Готово — решает автор',
    DONE: 'Закрыто автором',
  },
  priority: { LOW: 'Низкий', MEDIUM: 'Средний', HIGH: 'Высокий', URGENT: 'Срочный' },
  filterAll: 'Все',
  filterOnMe: 'На мне',
  filterWatching: 'Слежу',
  search: 'Фильтр задач…',
  everyone: 'Все',
  waitingOn: 'Ждёт',
  onYou: 'На вас',
  overdue: 'Просрочено',
  noTasks: 'Нет задач',
  showOlderDone: (d) => `«Готово» показывает последние ${d} дней. Показать все`,
  fieldTitle: 'Название',
  fieldDescription: 'Описание',
  fieldAssignees: 'Исполнители',
  fieldPriority: 'Приоритет',
  fieldDue: 'Срок',
  fieldStage: 'Этап',
  fieldCreatedBy: 'Создал',
  fieldWatchers: 'Наблюдатели',
  fieldHoldReason: 'Почему отложено',
  holdReasonPlaceholder: 'Владелец, поставщик, дата…',
  startAs: 'Начать в',
  watch: 'Следить',
  watching: 'Слежу',
  nowOn: 'Сейчас на',
  reason: { waiting: 'ждёт ответа', review: 'проверить и закрыть', triage: 'принять и назначить', assigned: 'назначено', none: '' },
  nobody: 'Никто',
  askSomeone: 'Ждём ответа от…',
  clear: 'Снять',
  thread: 'Обсуждение',
  replyPlaceholder: 'Напишите ответ… @ отметит коллегу',
  putOn: (n) => `Задача ждёт ${n}, пока не ответит`,
  putOnHint: 'Отметка только уведомляет. Отметьте галочкой, если ход за ним.',
  responsible: 'Ответственный',
  fieldRecords: 'Связанные записи',
  linkRecord: 'Привязать запись',
  pickTable: 'Таблица',
  pickRecord: 'Найти запись…',
  pickField: 'Атрибут (необязательно)',
  wholeRecord: 'Вся запись',
  addLink: 'Добавить',
  restricted: 'Скрытая запись',
  noRecords: 'Ничего не найдено',
  needsAssignee: 'Сначала назначьте исполнителя — у активной задачи всегда есть ответственный.',
  lastAssignee: 'У активной задачи должен быть ответственный. Сначала добавьте нового исполнителя, потом уберите последнего.',
  send: 'Отправить',
  closeDone: 'Закрыть как выполненную',
  closeWontDo: 'Закрыть без выполнения',
  reopen: 'Открыть снова',
  closedAs: (how, who) => `Закрыто (${how}) — ${who}`,
  wontDo: 'без выполнения',
  sendToReview: 'Предложить закрыть',
  notifications: 'Уведомления',
  markAllRead: 'Прочитать все',
  noNotifications: 'Ничего нового.',
  notif: {
    assigned: (a) => `${a} назначил вам задачу`,
    mention: (a, t) => `${a} отметил вас: «${t}»`,
    comment: (a, t) => `${a} ответил: «${t}»`,
    status: (a, t) => `${a} перенёс задачу в ${t}`,
    closed: (a) => `${a} закрыл задачу`,
    reopened: (a) => `${a} снова открыл задачу`,
    waiting: (a, t) => `${a} ждёт вашего ответа${t ? `: «${t}»` : ''}`,
    edited: (a) => `${a} изменил приоритет или срок`,
    suggest_close: (a) => `${a} предлагает закрыть задачу`,
  },
  event: {
    created: 'создал задачу',
    moved: (f, t) => `перенёс из ${f} в ${t}`,
    assigned: (a, r) => [a && `назначил ${a}`, r && `снял ${r}`].filter(Boolean).join(', '),
    closed: (how) => `закрыл (${how})`,
    reopened: 'открыл снова',
    edited: (f) => `изменил ${f}`,
    waiting: (w) => `ждёт ${w}`,
    wait_cleared: (w) => `больше не ждёт ${w}`,
    linked: (w) => `привязал ${w}`,
    unlinked: (w) => `отвязал ${w}`,
  },
  onlyManagersClose: "Закрыть или снова открыть задачу может только её автор. Перенесите её «На проверку», чтобы предложить закрытие.",
  dragNotAllowed: 'Перемещать задачу могут только исполнители или менеджер.',
  shortcutHint: 'N — новая задача',
};

const uk: TaskStrings = {
  ...en,
  navLabel: 'Завдання',
  title: 'Завдання',
  subtitle: 'Хто за що відповідає і на кому висить кожне завдання.',
  newTask: 'Нове завдання',
  create: 'Створити завдання',
  cancel: 'Скасувати',
  save: 'Зберегти',
  edit: 'Змінити',
  stage: { NEW: 'Нові', TODO: 'До виконання', IN_PROGRESS: 'В роботі', ON_HOLD: 'Відкладено', REVIEW: 'На перевірці', DONE: 'Готово' },
  stageHint: {
    NEW: 'Ще не прийнято',
    TODO: 'Прийнято, не розпочато',
    IN_PROGRESS: 'В роботі',
    ON_HOLD: 'Заблоковано або відкладено',
    REVIEW: 'Готово — вирішує автор',
    DONE: 'Закрито автором',
  },
  priority: { LOW: 'Низький', MEDIUM: 'Середній', HIGH: 'Високий', URGENT: 'Терміновий' },
  filterAll: 'Усі',
  filterOnMe: 'На мені',
  filterWatching: 'Стежу',
  search: 'Фільтр завдань…',
  everyone: 'Усі',
  waitingOn: 'Чекає на',
  onYou: 'На вас',
  overdue: 'Прострочено',
  noTasks: 'Немає завдань',
  showOlderDone: (d) => `«Готово» показує останні ${d} днів. Показати все`,
  fieldTitle: 'Назва',
  fieldDescription: 'Опис',
  fieldAssignees: 'Виконавці',
  fieldPriority: 'Пріоритет',
  fieldDue: 'Термін',
  fieldStage: 'Етап',
  fieldCreatedBy: 'Створив',
  fieldWatchers: 'Спостерігачі',
  fieldHoldReason: 'Чому відкладено',
  holdReasonPlaceholder: 'Власник, постачальник, дата…',
  startAs: 'Почати в',
  watch: 'Стежити',
  watching: 'Стежу',
  nowOn: 'Зараз на',
  reason: { waiting: 'чекає відповіді', review: 'перевірити й закрити', triage: 'прийняти й призначити', assigned: 'призначено', none: '' },
  nobody: 'Ніхто',
  askSomeone: 'Чекаємо на…',
  clear: 'Зняти',
  thread: 'Обговорення',
  replyPlaceholder: 'Напишіть відповідь… @ позначить колегу',
  putOn: (n) => `Завдання чекає на ${n}, доки не відповість`,
  putOnHint: 'Позначка лише сповіщає. Позначте галочкою, якщо хід за ним.',
  responsible: 'Відповідальний',
  fieldRecords: 'Пов’язані записи',
  linkRecord: 'Прив’язати запис',
  pickTable: 'Таблиця',
  pickRecord: 'Знайти запис…',
  pickField: 'Атрибут (необов’язково)',
  wholeRecord: 'Увесь запис',
  addLink: 'Додати',
  restricted: 'Прихований запис',
  noRecords: 'Нічого не знайдено',
  needsAssignee: 'Спочатку призначте виконавця — активне завдання завжди має відповідального.',
  lastAssignee: 'Активне завдання повинно мати відповідального. Спочатку додайте нового виконавця, потім приберіть останнього.',
  send: 'Надіслати',
  closeDone: 'Закрити як виконане',
  closeWontDo: 'Закрити без виконання',
  reopen: 'Відкрити знову',
  closedAs: (how, who) => `Закрито (${how}) — ${who}`,
  wontDo: 'без виконання',
  sendToReview: 'Запропонувати закрити',
  notifications: 'Сповіщення',
  markAllRead: 'Прочитати все',
  noNotifications: 'Нічого нового.',
  notif: {
    assigned: (a) => `${a} призначив вам завдання`,
    mention: (a, t) => `${a} позначив вас: «${t}»`,
    comment: (a, t) => `${a} відповів: «${t}»`,
    status: (a, t) => `${a} переніс завдання в ${t}`,
    closed: (a) => `${a} закрив завдання`,
    reopened: (a) => `${a} знову відкрив завдання`,
    waiting: (a, t) => `${a} чекає на вашу відповідь${t ? `: «${t}»` : ''}`,
    edited: (a) => `${a} змінив пріоритет або термін`,
    suggest_close: (a) => `${a} пропонує закрити завдання`,
  },
  event: {
    created: 'створив завдання',
    moved: (f, t) => `переніс з ${f} в ${t}`,
    assigned: (a, r) => [a && `призначив ${a}`, r && `зняв ${r}`].filter(Boolean).join(', '),
    closed: (how) => `закрив (${how})`,
    reopened: 'відкрив знову',
    edited: (f) => `змінив ${f}`,
    waiting: (w) => `чекає на ${w}`,
    wait_cleared: (w) => `більше не чекає на ${w}`,
    linked: (w) => `прив’язав ${w}`,
    unlinked: (w) => `відв’язав ${w}`,
  },
  onlyManagersClose: "Закрити або знову відкрити завдання може лише його автор. Перенесіть його «На перевірку», щоб запропонувати закриття.",
  dragNotAllowed: 'Переміщувати завдання можуть лише виконавці або менеджер.',
  shortcutHint: 'N — нове завдання',
};

export const taskStrings: Record<Locale, TaskStrings> = { en, cs, ru, uk };
