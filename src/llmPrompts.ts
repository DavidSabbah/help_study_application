import { OcrLanguageCode, ProblemTypeKey } from './types';

export interface ProblemChoice {
  key: ProblemTypeKey;
  /** Label in the language the LLM will be asked in. */
  label: string;
  /** Short English meaning, shown when the ask-language is not English. */
  hint: string;
}

const ENGLISH_HINTS: Record<ProblemTypeKey, string> = {
  explain_lines: 'Explain these lines',
  solve_problem: 'Solve this problem',
  notebook_lesson: 'Explain with my notebook',
  summarize: 'Summarize',
  argument: 'Break down the argument',
  raw_only: 'Text only'
};

const LABELS: Record<OcrLanguageCode, Record<ProblemTypeKey, string>> = {
  eng: {
    explain_lines: 'Explain these lines',
    solve_problem: 'Solve this problem',
    notebook_lesson: 'Explain with my notebook',
    summarize: 'Summarize',
    argument: 'Break down the argument',
    raw_only: 'Text only'
  },
  fra: {
    explain_lines: 'Explique ces lignes',
    solve_problem: 'Résous ce problème',
    notebook_lesson: 'Explique avec mon cahier',
    summarize: 'Résume',
    argument: "Analyse l'argument",
    raw_only: 'Texte seul'
  },
  heb: {
    explain_lines: 'הסבר את השורות',
    solve_problem: 'פתור את הבעיה',
    notebook_lesson: 'הסבר עם המחברת',
    summarize: 'סכם',
    argument: 'נתח את הטיעון',
    raw_only: 'רק הטקסט'
  },
  deu: {
    explain_lines: 'Erklär diese Zeilen',
    solve_problem: 'Löse diese Aufgabe',
    notebook_lesson: 'Erklär mit meinem Heft',
    summarize: 'Fasse zusammen',
    argument: 'Analysiere das Argument',
    raw_only: 'Nur der Text'
  },
  spa: {
    explain_lines: 'Explica estas líneas',
    solve_problem: 'Resuelve este problema',
    notebook_lesson: 'Explica con mi cuaderno',
    summarize: 'Resume',
    argument: 'Analiza el argumento',
    raw_only: 'Solo el texto'
  },
  ita: {
    explain_lines: 'Spiega queste righe',
    solve_problem: 'Risolvi questo problema',
    notebook_lesson: 'Spiega con il mio quaderno',
    summarize: 'Riassumi',
    argument: "Analizza l'argomento",
    raw_only: 'Solo il testo'
  },
  por: {
    explain_lines: 'Explica estas linhas',
    solve_problem: 'Resolve este problema',
    notebook_lesson: 'Explica com o meu caderno',
    summarize: 'Resume',
    argument: 'Analisa o argumento',
    raw_only: 'Só o texto'
  },
  lat: {
    explain_lines: 'Explica has lineas',
    solve_problem: 'Solve hoc problema',
    notebook_lesson: 'Explica ex meo commentario',
    summarize: 'Summatim expone',
    argument: 'Explica argumentum',
    raw_only: 'Solus textus'
  },
  grc: {
    explain_lines: 'Ἐξήγησαι τὰς γραμμάς',
    solve_problem: 'Λῦσον τὸ πρόβλημα',
    notebook_lesson: 'Ἐξήγησαι ἐκ τοῦ τετραδίου',
    summarize: 'Συνόψισον',
    argument: 'Ἀνάλυσε τὸ ἐπιχείρημα',
    raw_only: 'Μόνον ὁ λόγος'
  }
};

const INSTRUCTIONS: Record<OcrLanguageCode, Record<Exclude<ProblemTypeKey, 'raw_only'>, string>> = {
  eng: {
    explain_lines:
      'Answer in English.\nExplain these lines to me.\n1. Say clearly what the text means.\n2. Explain the important words and ideas.\n3. Give a concrete example if that helps.',
    solve_problem:
      'Answer in English.\nSolve this problem.\nShow each step of the reasoning, then give the final answer. If something is missing, say what is missing.',
    notebook_lesson:
      'Answer in English.\nUsing the documents in my notebook, explain this passage.\nConnect it to the authors, concepts, and arguments from the lesson.',
    summarize:
      'Answer in English.\nSummarize this text. First the main idea, then the important points.',
    argument:
      'Answer in English.\nBreak down the argument in this text: the thesis, the premises, and any weak points.'
  },
  fra: {
    explain_lines:
      'Réponds en français.\nExplique-moi ces lignes.\n1. Dis clairement ce que le texte veut dire.\n2. Explique les mots et les idées importantes.\n3. Donne un exemple concret si ça aide.',
    solve_problem:
      'Réponds en français.\nRésous ce problème.\nMontre chaque étape du raisonnement, puis donne la réponse finale. Si une information manque, dis laquelle.',
    notebook_lesson:
      "Réponds en français.\nEn t'appuyant sur les documents de mon cahier, explique cet extrait.\nRelie-le aux auteurs, aux notions et aux arguments du cours.",
    summarize:
      "Réponds en français.\nRésume ce texte. D'abord l'idée principale, puis les points importants.",
    argument:
      "Réponds en français.\nAnalyse l'argument de ce texte : la thèse, les prémisses, et les points faibles."
  },
  heb: {
    explain_lines:
      'ענה בעברית.\nהסבר לי את השורות האלה.\n1. אמור בבירור מה הטקסט אומר.\n2. הסבר את המילים והרעיונות החשובים.\n3. תן דוגמה מוחשית אם זה עוזר.',
    solve_problem:
      'ענה בעברית.\nפתור את הבעיה הזו.\nהראה כל שלב בהסבר, ואז תן את התשובה הסופית. אם חסר נתון, כתוב מה חסר.',
    notebook_lesson:
      'ענה בעברית.\nהישען על המסמכים במחברת שלי והסבר את הקטע הזה.\nקשר אותו לכותבים, למושגים ולטיעונים של השיעור.',
    summarize:
      'ענה בעברית.\nסכם את הטקסט. קודם הרעיון המרכזי, אחר כך הנקודות החשובות.',
    argument:
      'ענה בעברית.\nנתח את הטיעון בטקסט: התזה, ההנחות, ונקודות החולשה.'
  },
  deu: {
    explain_lines:
      'Antworte auf Deutsch.\nErklär mir diese Zeilen.\n1. Sag klar, was der Text bedeutet.\n2. Erklär die wichtigen Wörter und Ideen.\n3. Gib ein konkretes Beispiel, wenn das hilft.',
    solve_problem:
      'Antworte auf Deutsch.\nLöse diese Aufgabe.\nZeig jeden Schritt der Überlegung und gib danach die endgültige Antwort. Wenn etwas fehlt, sag was fehlt.',
    notebook_lesson:
      'Antworte auf Deutsch.\nErklär diese Stelle mit den Dokumenten in meinem Heft.\nVerbinde sie mit den Autoren, Begriffen und Argumenten der Stunde.',
    summarize:
      'Antworte auf Deutsch.\nFasse diesen Text zusammen. Zuerst die Hauptidee, dann die wichtigen Punkte.',
    argument:
      'Antworte auf Deutsch.\nAnalysiere das Argument in diesem Text: These, Prämissen und schwache Stellen.'
  },
  spa: {
    explain_lines:
      'Responde en español.\nExplícame estas líneas.\n1. Di con claridad qué significa el texto.\n2. Explica las palabras y las ideas importantes.\n3. Da un ejemplo concreto si ayuda.',
    solve_problem:
      'Responde en español.\nResuelve este problema.\nMuestra cada paso del razonamiento y después da la respuesta final. Si falta un dato, di cuál.',
    notebook_lesson:
      'Responde en español.\nApoyándote en los documentos de mi cuaderno, explica este fragmento.\nRelaciónalo con los autores, los conceptos y los argumentos de la clase.',
    summarize:
      'Responde en español.\nResume este texto. Primero la idea principal y después los puntos importantes.',
    argument:
      'Responde en español.\nAnaliza el argumento de este texto: la tesis, las premisas y los puntos débiles.'
  },
  ita: {
    explain_lines:
      'Rispondi in italiano.\nSpiegami queste righe.\n1. Di’ chiaramente che cosa significa il testo.\n2. Spiega le parole e le idee importanti.\n3. Fai un esempio concreto se serve.',
    solve_problem:
      'Rispondi in italiano.\nRisolvi questo problema.\nMostra ogni passaggio del ragionamento e poi dai la risposta finale. Se manca un dato, dillo.',
    notebook_lesson:
      'Rispondi in italiano.\nUsando i documenti del mio quaderno, spiega questo brano.\nCollegalo agli autori, ai concetti e agli argomenti della lezione.',
    summarize:
      'Rispondi in italiano.\nRiassumi questo testo. Prima l’idea principale, poi i punti importanti.',
    argument:
      'Rispondi in italiano.\nAnalizza l’argomento di questo testo: la tesi, le premesse e i punti deboli.'
  },
  por: {
    explain_lines:
      'Responde em português.\nExplica-me estas linhas.\n1. Diz com clareza o que o texto significa.\n2. Explica as palavras e as ideias importantes.\n3. Dá um exemplo concreto se ajudar.',
    solve_problem:
      'Responde em português.\nResolve este problema.\nMostra cada passo do raciocínio e depois dá a resposta final. Se faltar um dado, diz qual.',
    notebook_lesson:
      'Responde em português.\nCom base nos documentos do meu caderno, explica esta passagem.\nLiga-a aos autores, aos conceitos e aos argumentos da aula.',
    summarize:
      'Responde em português.\nResume este texto. Primeiro a ideia principal, depois os pontos importantes.',
    argument:
      'Responde em português.\nAnalisa o argumento deste texto: a tese, as premissas e os pontos fracos.'
  },
  lat: {
    explain_lines:
      'Responde Latine.\nExplica mihi has lineas.\n1. Dic clare quid textus significet.\n2. Explica verba et notiones magni momenti.\n3. Da exemplum concretum, si prodest.',
    solve_problem:
      'Responde Latine.\nSolve hoc problema.\nOstende singulos gradus rationis, deinde da responsum finale. Si quid deest, dic quid desit.',
    notebook_lesson:
      'Responde Latine.\nDocumentis commentarii mei usus, hunc locum explica.\nConecte eum cum auctoribus, notionibus et argumentis lectionis.',
    summarize:
      'Responde Latine.\nHunc textum summatim expone. Primum sententiam principalem, deinde puncta gravia.',
    argument:
      'Responde Latine.\nArgumentum huius textus explica: thesim, praemissas, et locos infirmos.'
  },
  grc: {
    explain_lines:
      'Ἀπόκριναι Ἑλληνιστί.\nἘξήγησαί μοι ταύτας τὰς γραμμάς.\n1. Εἰπὲ σαφῶς τί ὁ λόγος σημαίνει.\n2. Ἐξήγησαι τὰ σημαντικὰ ὀνόματα καὶ τὰς ἐννοίας.\n3. Δὸς παράδειγμα συγκεκριμένον, εἰ ὠφελεῖ.',
    solve_problem:
      'Ἀπόκριναι Ἑλληνιστί.\nΛῦσον τοῦτο τὸ πρόβλημα.\nΔεῖξον ἕκαστον βῆμα τοῦ συλλογισμοῦ, εἶτα δὸς τὴν τελικὴν ἀπόκρισιν. Εἰ τι λείπει, εἰπὲ τί λείπει.',
    notebook_lesson:
      'Ἀπόκριναι Ἑλληνιστί.\nΧρώμενος τοῖς ἐγγράφοις τοῦ ἐμοῦ τετραδίου, ἐξήγησαι τόδε τὸ ἀπόσπασμα.\nΣύνδεε αὐτὸ τοῖς συγγραφεῦσι, ταῖς ἐννοίαις καὶ τοῖς λόγοις τοῦ μαθήματος.',
    summarize:
      'Ἀπόκριναι Ἑλληνιστί.\nΣυνόψισον τοῦτον τὸν λόγον. Πρῶτον τὴν κυρίαν ἰδέαν, ἔπειτα τὰ σπουδαῖα σημεῖα.',
    argument:
      'Ἀπόκριναι Ἑλληνιστί.\nἈνάλυσε τὸ ἐπιχείρημα τούτου τοῦ λόγου: τὴν θέσιν, τὰς προτάσεις, καὶ τὰ ἀσθενῆ σημεῖα.'
  }
};

const QUESTION_LABEL: Record<OcrLanguageCode, string> = {
  eng: 'My question:',
  fra: 'Ma question :',
  heb: 'השאלה שלי:',
  deu: 'Meine Frage:',
  spa: 'Mi pregunta:',
  ita: 'La mia domanda:',
  por: 'A minha pergunta:',
  lat: 'Quaestio mea:',
  grc: 'Τὸ ἐμὸν ἐρώτημα:'
};

const PLACEHOLDERS: Record<OcrLanguageCode, string> = {
  eng: 'e.g. What does this passage mean?',
  fra: 'ex. Que veut dire ce passage ?',
  heb: 'למשל: מה הכוונה כאן?',
  deu: 'z. B. Was bedeutet diese Stelle?',
  spa: 'p. ej. ¿Qué significa este pasaje?',
  ita: 'es. Che cosa significa questo passo?',
  por: 'ex. O que significa esta passagem?',
  lat: 'ex. gr. Quid hic locus significat?',
  grc: 'π.χ. Τί σημαίνει οὗτος ὁ τόπος;'
};

export const ASK_LANGUAGE_NAME: Record<OcrLanguageCode, string> = {
  eng: 'English',
  fra: 'Français',
  heb: 'עברית',
  deu: 'Deutsch',
  spa: 'Español',
  ita: 'Italiano',
  por: 'Português',
  lat: 'Latina',
  grc: 'Ἑλληνική'
};

const PROBLEM_ORDER: ProblemTypeKey[] = [
  'explain_lines',
  'solve_problem',
  'notebook_lesson',
  'summarize',
  'argument',
  'raw_only'
];

export function isRtlLanguage(code: OcrLanguageCode): boolean {
  return code === 'heb';
}

export function problemsFor(lang: OcrLanguageCode): ProblemChoice[] {
  return PROBLEM_ORDER.map((key) => ({
    key,
    label: LABELS[lang][key],
    hint: ENGLISH_HINTS[key]
  }));
}

export function questionPlaceholder(lang: OcrLanguageCode): string {
  return PLACEHOLDERS[lang];
}

export function buildStudyPrompt(
  lang: OcrLanguageCode,
  problem: ProblemTypeKey,
  ocrText: string,
  question: string
): string {
  const text = ocrText.trim();
  const extra = question.trim();
  const questionLine = extra ? `\n\n${QUESTION_LABEL[lang]} ${extra}` : '';

  if (problem === 'raw_only') {
    return extra ? `${text}${questionLine}` : text;
  }

  return `${INSTRUCTIONS[lang][problem]}\n\n"""\n${text}\n"""${questionLine}`;
}
