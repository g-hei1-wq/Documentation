# Racing Protocols

A browser-based prototype for documenting changes by priority, attaching drawings and photos, and controlling which workspace members can view each record.

## Open the prototype

Open `index.html` directly in a modern browser. No build step or server is needed.

## Publish a public demo

The repository includes a GitHub Actions workflow for GitHub Pages. Create a public GitHub repository, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**, then push this project to its `main` branch. The deployment job will publish the static demo and report its URL. The workflow deploys only the front-end prototype. Each visitor's accounts and records remain local to their own browser and are not shared with the workspace owner.

Demo accounts:

- Administrator: `admin@example.com` / `admin123`
- Member: `alex@example.com` / `demo123`

The administrator can create accounts, nominate administrators by role, change a member's password, review every record, and share individual records with selected members. Members can submit records and view their own or explicitly shared records.

## Local prototype limits

This is a front-end demonstration, not a secure multi-user system. Accounts, roles, passwords, and record metadata are stored in browser `localStorage`; attachments are stored in that browser's `IndexedDB`. Data is not shared between browsers or devices, and clearing browser storage removes it. Client-side role checks can be bypassed, and passwords are not securely hashed. A public deployment is suitable only as a demo with sample data. Do not enter real personal, confidential, or operational information.

The form accepts individual files up to 500 MB and descriptions up to 1000 words. Actual upload capacity depends on available browser storage and may be lower; this prototype does not upload to a server or provide durable backups.

## Before production use

Connect the interface to a server-side application with authenticated sessions, authorization enforced on every endpoint, securely hashed passwords, admin-only account and password management, persisted per-record access rules, and durable file/object storage configured for 500 MB uploads. Add server-side validation, audit logging, backup/retention policies, and deployment-specific security review. Do not treat browser storage or UI role checks as access control.
