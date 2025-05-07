// Mock VS Code API for testing
export interface Thenable<T> {
  then<TResult>(
    onfulfilled?: (value: T) => TResult | Thenable<TResult>,
    onrejected?: (reason: any) => TResult | Thenable<TResult>
  ): Thenable<TResult>;
  catch<TResult>(onrejected?: (reason: any) => TResult | Thenable<TResult>): Thenable<TResult>;
}

export interface Disposable {
  dispose(): any;
}

export interface ExtensionContext {
  subscriptions: { dispose(): any }[];
  extensionPath: string;
  globalStoragePath: string;
  globalStorageUri: Uri;
  logPath: string;
  storagePath: string;
  extensionUri: Uri;
  environmentVariableCollection: any;
  storage: {
    get(key: string): any;
    update(key: string, value: any): Thenable<void>;
  };
  globalState: {
    get(key: string): any;
    update(key: string, value: any): Thenable<void>;
  };
}

export class Uri {
  constructor(public fsPath: string) {}
  static file(path: string): Uri {
    return new Uri(path);
  }
}

export class WorkspaceFolder {
  constructor(
    public uri: Uri,
    public name: string,
    public index: number
  ) {}
}

export class TextDocument {
  constructor(public uri: Uri) {}
}

export class TextEditor {
  constructor(public document: TextDocument) {}
}

export class RelativePattern {
  constructor(base: string, pattern: string) {
    this.base = base;
    this.pattern = pattern;
  }
  base: string;
  pattern: string;
}

export const workspace = {
  workspaceFolders: [new WorkspaceFolder(Uri.file('/workspace'), 'workspace', 0)],
  getWorkspaceFolder: (uri: Uri) => new WorkspaceFolder(uri, 'workspace', 0),
  createFileSystemWatcher: (pattern: RelativePattern) => ({
    onDidCreate: (listener: (uri: Uri) => any) => ({ dispose: () => {} }),
    onDidChange: (listener: (uri: Uri) => any) => ({ dispose: () => {} }),
    onDidDelete: (listener: (uri: Uri) => any) => ({ dispose: () => {} }),
    dispose: () => {}
  })
};

export const window = {
  activeTextEditor: new TextEditor(new TextDocument(Uri.file('/workspace/test.ts')))
};

export const Range = class {
  constructor(start: number, end: number) {
    this.start = start;
    this.end = end;
  }
  start: number;
  end: number;
};

export const Position = class {
  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }
  line: number;
  character: number;
};

export const commands = {
  registerCommand: () => ({ dispose: () => {} })
};

export const StatusBarAlignment = {
  Left: 1,
  Right: 2
};

export const statusBarItem = {
  text: "",
  show: () => {},
  hide: () => {},
  dispose: () => {}
};

export const StatusBarItem = class {
  text = "";
  show() {}
  hide() {}
  dispose() {}
};

export const windowStatusBarItem = new StatusBarItem();

export const createStatusBarItem = () => windowStatusBarItem; 