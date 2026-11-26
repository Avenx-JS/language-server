import {
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';

/**
 * Text synchronization: keeps `context.documents` in step with the client.
 * @type {import('./index.js').Feature}
 */
export const documentsFeature = {
  name: 'documents',

  capabilities: () => ({
    textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Incremental },
  }),

  register({ documents, onNotification }) {
    onNotification(DidOpenTextDocumentNotification.type, ({ textDocument }) => {
      documents.open(textDocument);
    });
    onNotification(DidChangeTextDocumentNotification.type, ({ textDocument, contentChanges }) => {
      documents.change(textDocument, contentChanges);
    });
    onNotification(DidCloseTextDocumentNotification.type, ({ textDocument }) => {
      documents.close(textDocument.uri);
    });
  },
};
