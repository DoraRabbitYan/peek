# X native bookmark folders

Click the bookmark icon inside Peek to choose a folder from the signed-in X account, or save to all bookmarks only. Existing bookmarks can be assigned to a folder; removing a bookmark is an explicit separate action. Create and manage folders through X's native bookmark page.

Folder access depends on the account's X entitlement. Ordinary bookmarking remains available when folder loading fails. The picker supports pagination, deduplication, double-click protection, and only reports a folder save as successful after the response confirms it. It does not create local substitute categories or request additional extension permissions.

After reloading the extension, refresh existing X tabs to replace their old content scripts.

## Validation

- 119 automated tests, including 12 folder-specific tests covering parsing, pagination, permission errors, failed writes, double clicks, existing bookmark counts, and empty mutation responses.
- On September 25, 2026, the picker opened in Chrome and displayed folders from the signed-in X account. The user subsequently accepted the feature.
- The agent did not independently verify a real write in X; mocked tests are not evidence of a successful live write.

## Interface references

Operation definitions are discovered from the current X page's Webpack runtime. Query IDs are not hardcoded and credentials are not persisted.

- [X account requirements](https://help.x.com/en/using-x/x-premium-how-to)
- [agentx interface reference](https://github.com/dezxbt/agentx/blob/main/pkg/xclient/bookmarkfolders.go)
- [twikit pagination reference](https://github.com/d60/twikit/blob/main/twikit/client/gql.py)
