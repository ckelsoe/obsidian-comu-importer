// Synthetic Comu API payloads in the shapes recorded from the web portal on
// 2026-11-05. Names and text are invented; no real recording is used.

export const NOTE_ID = '4d4b0c1e-0000-4000-8000-000000000001';

export const LIST_ITEM = {
	title: 'Weekly planning',
	noteId: NOTE_ID,
	trash: false,
	duration: 2196,
	createTime: '2026-11-03T20:34:17Z',
	updateTime: '2026-11-05T15:10:25Z',
	startTime: '2026-11-03T19:57:21Z',
	summaryStatus: 2,
	transcribeStatus: 2,
	audioUrl: null,
	dir: null,
	source: null,
};

export const TRANSCRIPT_DATA = {
	noteId: NOTE_ID,
	asrResultVO: [
		{
			content: 'Good morning.',
			startMs: 1660,
			endMs: 3180,
			speakerName: 'Alex',
		},
		{ content: '  ', startMs: 3200, endMs: 3300, speakerName: 'Alex' },
		{
			content: 'Morning, let us start.',
			startMs: 3400,
			endMs: 6000,
			speakerName: 'Sam',
		},
	],
	speakers: [],
};

export const SUMMARY_DATA = {
	noteId: NOTE_ID,
	noteSummaryDetailVO: {
		summaryContent:
			'### Overview of the call\n\nA short planning call.\n\n### Overview\n- Agreed the plan',
	},
	noteInsightDetailVO: {
		insightContent:
			'### Key points\n\n- **Owner**\n  - [Alex](speaker:4d4b0c1e-aaaa-4000-8000-000000000002) leads',
	},
};

export const OUTLINE_DATA = {
	noteId: NOTE_ID,
	outlines: [
		{
			itemType: 'OUTLINE',
			startTime: 1660,
			endTime: 107610,
			content: 'Opening',
		},
		{
			itemType: 'OUTLINE',
			startTime: 107610,
			endTime: 2196000,
			content: 'Planning',
		},
	],
};

export const TODO_DATA = [
	{
		actionContent: 'Send the\nagenda',
		actionStatus: 0,
		ownerList: [{ stakeholderName: 'Sam' }],
	},
	{ actionContent: 'Book the room', actionStatus: 1, ownerList: [] },
];

export const ok = (data: unknown) => ({
	code: 0,
	success: true,
	msg: null,
	data,
});
