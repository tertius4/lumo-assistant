import * as vscode from "vscode";
import * as path from "path";

export interface IndexedFile {
  path: string;
  relativePath: string;
  language: string;
  size: number;
  lastModified: number;
}

export interface WorkspaceIndex {
  workspaceName: string;
  fileCount: number;
  files: IndexedFile[];
}

export class WorkspaceIndexer {
  private index: WorkspaceIndex | null = null;

  async build(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      this.index = null;
      return;
    }

    const files = await vscode.workspace.findFiles("**/*", "**/{node_modules,dist,build,.git}/**");

    const indexedFiles: IndexedFile[] = [];

    for (const file of files) {
      try {
        const stat = await vscode.workspace.fs.stat(file);

        indexedFiles.push({
          path: file.fsPath,
          relativePath: path.relative(workspaceFolder.uri.fsPath, file.fsPath),
          language: path.extname(file.fsPath),
          size: stat.size,
          lastModified: stat.mtime,
        });
      } catch {
        // ignore unreadable files
      }
    }

    this.index = {
      workspaceName: workspaceFolder.name,
      fileCount: indexedFiles.length,
      files: indexedFiles,
    };
  }

  getIndex(): WorkspaceIndex | null {
    return this.index;
  }
}
