import {
  DiagnosticSeverity,
  DidChangeWatchedFilesNotification,
  DidChangeWorkspaceFoldersNotification,
  WatchKind,
} from 'vscode-languageserver/node';

/**
 * File watchers registered with the client. Content changes of sources do not
 * matter to the project model, only files and folders appearing and
 * disappearing; a renamed folder arrives as delete + create of the folder.
 */
export const WATCHERS = [
  { globPattern: '**/avenx.config.json' },
  { globPattern: '**/*', kind: WatchKind.Create | WatchKind.Delete },
];

/**
 * The project model: discovers projects in the workspace folders, keeps their
 * registries current and publishes avenx.config.json problems.
 * @type {import('./index.js').Feature}
 */
export const projectsFeature = {
  name: 'projects',

  capabilities: () => ({
    workspace: { workspaceFolders: { supported: true, changeNotifications: true } },
  }),

  register({ connection, documents, projects, onNotification }) {
    onNotification(DidChangeWatchedFilesNotification.type, ({ changes }) => projects.handleWatchedFiles(changes));
    onNotification(DidChangeWorkspaceFoldersNotification.type, async ({ event }) => {
      await projects.removeFolders(event.removed);
      await projects.addFolders(event.added);
    });

    // The open text of avenx.config.json wins over the file on disk.
    const configEdited = (document) => {
      if (document.kind === 'config') {
        projects.configDocumentChanged(document.uri);
      }
    };
    documents.onDidOpen(configEdited);
    documents.onDidChange(configEdited);
    documents.onDidClose(configEdited);

    projects.onDidChangeProject(({ project, reason }) => {
      if (reason === 'removed') {
        connection.sendDiagnostics({ uri: project.configUri, diagnostics: [] });
      } else if (reason === 'added' || reason === 'config') {
        connection.sendDiagnostics(configDiagnostics(project));
      }
    });
  },

  async initialized({ connection, clientCapabilities, logger, projects, workspaceFolders }) {
    if (clientCapabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration) {
      await connection.client.register(DidChangeWatchedFilesNotification.type, { watchers: WATCHERS });
    } else {
      logger.info(
        'The client cannot register file watchers; new or deleted components are seen only if it sends file events itself.',
      );
    }
    await projects.addFolders(workspaceFolders);
    logger.info(`Found ${projects.all().length} Avenx project(s).`);
  },
};

/**
 * @param {import('../project/project.js').Project} project
 * @returns {import('vscode-languageserver/node').PublishDiagnosticsParams}
 */
export function configDiagnostics(project) {
  const document = project.configDocument;
  return {
    uri: project.configUri,
    ...(document?.version != null ? { version: document.version } : {}),
    diagnostics: project.problems.map((problem) => ({
      range: document.rangeAt(problem.start, problem.end),
      severity: problem.severity === 'warning' ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
      source: 'avenx',
      code: problem.code,
      message: problem.message,
    })),
  };
}
