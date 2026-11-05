import { Notice, Platform, Plugin, type ObsidianProtocolData } from 'obsidian';
import {
	managedMarkers,
	type ImportModalOptions,
} from 'obsidian-recording-importer-core';
import { ComuClient, COMU_ERROR_POLICY, normalizeToken } from './comu-client';
import { clearSignInSession, openSignIn, type SignIn } from './comu-login';
import { readToken, TOKEN_SECRET_ID, type TokenInfo } from './comu-token';
import {
	bookmarkSetupHtml,
	buildBookmarklet,
	TOKEN_LINK_ACTION,
} from './comu-bookmarklet';
import { COMU_PROFILE } from './comu-profile';
import { ImportModal } from './import-modal';
import { ComuSettingTab } from './settings-tab';
import { normalizeSettings, type ComuImporterSettings } from './settings';

export default class ComuImporterPlugin extends Plugin {
	settings: ComuImporterSettings = normalizeSettings(undefined);
	client!: ComuClient;
	/** The open import window; at most one at a time. */
	private importModal: ImportModal | null = null;
	/** The open sign-in window, if any. */
	private signIn: SignIn | null = null;
	private settingTab: ComuSettingTab | null = null;
	/**
	 * Bumped by Sign out and unload. A sign-in or paste that started under an
	 * older value is stale and must not store its token.
	 */
	private authGeneration = 0;

	async onload(): Promise<void> {
		const data: unknown = await this.loadData();
		this.settings = normalizeSettings(data);
		this.migrateLegacySecret(data);
		this.client = new ComuClient(() => this.storedToken());
		this.settingTab = new ComuSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		// The browser bookmark hands the token back through this link.
		this.registerObsidianProtocolHandler(TOKEN_LINK_ACTION, (params) => {
			void this.handleTokenLink(params).catch((err: unknown) => {
				console.error('Comu importer: sign-in link failed', err);
				new Notice(
					'Comu importer: could not save the sign-in from your browser. Paste it in the plugin settings instead.',
				);
			});
		});
		this.addRibbonIcon('mic', 'Import recordings', () => {
			this.openImport();
		});
		this.addCommand({
			id: 'import-recordings',
			name: 'Import recordings',
			callback: () => {
				this.openImport();
			},
		});
	}

	onunload(): void {
		// Closing stops a running import at the next recording.
		this.importModal?.close();
		this.authGeneration++;
		this.signIn?.cancel();
	}

	/**
	 * Builds before the sign-in window kept the token in a secret the user
	 * picked (`tokenSecret`, default `comu-token`). Copy a usable one to the
	 * fixed secret once, unless the fixed secret already holds a token.
	 */
	private migrateLegacySecret(data: unknown): void {
		if (readToken(this.storedToken()) !== null) return;
		const picked =
			typeof data === 'object' && data !== null
				? (data as Record<string, unknown>)['tokenSecret']
				: undefined;
		const legacyId =
			typeof picked === 'string' && picked ? picked : 'comu-token';
		const legacy = this.app.secretStorage.getSecret(legacyId);
		if (readToken(legacy) !== null && legacy !== null) {
			this.app.secretStorage.setSecret(
				TOKEN_SECRET_ID,
				normalizeToken(legacy),
			);
		}
	}

	private storedToken(): string {
		return this.app.secretStorage.getSecret(TOKEN_SECRET_ID) ?? '';
	}

	/** What the stored token says about itself, or null when there is none. */
	tokenInfo(): TokenInfo | null {
		return readToken(this.storedToken());
	}

	/**
	 * Check `raw` with Comu, then store it. Returns true when stored. The old
	 * token is kept if the new one fails, so a bad paste never signs you out.
	 */
	async saveToken(raw: string): Promise<boolean> {
		const generation = this.authGeneration;
		const token = normalizeToken(raw);
		if (readToken(token) === null) {
			new Notice('Comu importer: that is not a token. Copy it again.');
			return false;
		}
		try {
			await new ComuClient(() => token).testConnection();
		} catch (err) {
			console.error('Comu importer: the token was rejected', err);
			new Notice(
				`Comu importer: ${err instanceof Error ? err.message : String(err)}`,
			);
			return false;
		}
		// Signed out or unloaded while Comu was checking: drop this token.
		if (generation !== this.authGeneration) return false;
		this.app.secretStorage.setSecret(TOKEN_SECRET_ID, token);
		const email = readToken(token)?.email;
		new Notice(
			email
				? `Comu importer: signed in as ${email}.`
				: 'Comu importer: signed in.',
		);
		return true;
	}

	/** Open the sign-in window; resolves true once a token is stored. */
	async runSignIn(): Promise<boolean> {
		if (this.signIn !== null) return false;
		const signIn = openSignIn(this.app);
		this.signIn = signIn;
		try {
			const token = await signIn.result;
			return token !== null && (await this.saveToken(token));
		} finally {
			if (this.signIn === signIn) this.signIn = null;
		}
	}

	private async handleTokenLink(params: ObsidianProtocolData): Promise<void> {
		// Built for one vault; another vault's bookmark is not for this one.
		if (params.vault !== this.app.vault.getName()) return;
		const token = params['token'];
		if (typeof token !== 'string' || token.length === 0) {
			new Notice(
				'Comu importer: the sign-in link carried no token. Sign in at web.comu.com, then click the bookmark again.',
			);
			return;
		}
		// Refresh the status line if the settings are open.
		if (
			(await this.saveToken(token)) &&
			this.settingTab?.containerEl.isConnected
		) {
			this.settingTab.update();
		}
	}

	/**
	 * Open the bookmark setup page in the system browser. Without desktop file
	 * access, copy the bookmark instead so it can be added by hand.
	 */
	async openBookmarkSetup(): Promise<void> {
		const vault = this.app.vault.getName();
		const req = (window as { require?: (id: string) => unknown }).require;
		if (!Platform.isDesktopApp || typeof req !== 'function') {
			await navigator.clipboard.writeText(buildBookmarklet(vault));
			new Notice(
				'Comu importer: bookmark copied. Make a new bookmark and paste it into the address field.',
			);
			return;
		}
		const os = req('os') as { tmpdir(): string };
		const fs = req('fs') as {
			writeFileSync(path: string, data: string): void;
		};
		const path = req('path') as { join(...parts: string[]): string };
		const file = path.join(os.tmpdir(), 'comu-importer-bookmark.html');
		fs.writeFileSync(file, bookmarkSetupHtml(vault));
		const shell = (
			req('electron') as {
				shell?: { openPath(path: string): Promise<string> };
			}
		).shell;
		if (shell === undefined) throw new Error('Electron shell unavailable');
		const failure = await shell.openPath(file);
		if (failure) throw new Error(failure);
	}

	async signOut(): Promise<void> {
		this.authGeneration++;
		this.signIn?.cancel();
		this.app.secretStorage.setSecret(TOKEN_SECRET_ID, '');
		try {
			await clearSignInSession(this.app);
		} catch (err) {
			console.error(
				'Comu importer: could not clear the sign-in window session',
				err,
			);
		}
		new Notice('Comu importer: signed out.');
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private openImport(): void {
		if (this.importModal !== null) return;
		const s = this.settings;
		const options: ImportModalOptions = {
			profile: COMU_PROFILE,
			errorPolicy: COMU_ERROR_POLICY,
			outputFolder: s.outputFolder,
			subfolderTemplate: s.subfolderTemplate,
			noteNameTemplate: s.noteNameTemplate,
			onDuplicate: s.duplicatePolicy,
			transcriptPlacement: s.transcriptPlacement,
			// Comu has no AI keyword tags; only the user's own tags would apply.
			tagMode: 'none',
			trashFile: (path) => {
				const file = this.app.vault.getAbstractFileByPath(path);
				return file === null
					? Promise.resolve()
					: this.app.fileManager.trashFile(file);
			},
		};
		const modal = new ImportModal(this.app, {
			client: this.client,
			options,
			includeAudio: s.includeAudio,
			showTrashed: s.showTrashed,
			markers: managedMarkers(COMU_PROFILE),
			onClosed: () => {
				if (this.importModal === modal) this.importModal = null;
			},
		});
		this.importModal = modal;
		modal.open();
	}
}
