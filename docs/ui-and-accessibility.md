# UI and accessibility

## Page regions

The application has three conceptual regions:

1. project navigation;
2. the document workspace (header and editor);
3. the writing partner.

`App` renders one desktop grid plus two below-desktop drawers. [`EditorWorkspace`](../src/components/EditorWorkspace.tsx) keeps the document header and editor together as the center region.

## Responsive layout

The desktop threshold is `80rem` (`xl` in Tailwind's default scale and the explicit media query in [`index.css`](../src/index.css)).

| Viewport | Navigation | Document | Writing partner | Workspace cards |
| --- | --- | --- | --- | --- |
| `<80rem` | Left modal drawer | Full available width | Right modal drawer | Hidden |
| `80rem–95.999rem` | Collapsible/resizable column, default 248 px | Fluid, minimum target 520 px during resize | Collapsible/resizable column, default 320 px | Visible |
| `>=96rem` | Default 280 px | Fluid | Default 360 px | Visible |

Opening suggestion detail applies a wider default writing-partner width (`clamp(30rem, 38vw, 40rem)`) in the first desktop range. An inline user-saved width takes precedence. At `96rem` and above, the later large-screen default currently wins in the CSS cascade.

Desktop panel open state and mobile drawer open state are intentionally separate. Crossing into desktop closes any open drawers. Collapsing a desktop panel does not imply that its mobile drawer is open, and vice versa.

## Desktop column resizing

[`ColumnResizeHandle`](../src/components/ColumnResizeHandle.tsx) renders an accessible vertical separator on each open side column.

### Limits

| Column | Minimum | Absolute maximum | Dynamic maximum rule |
| --- | ---: | ---: | --- |
| Navigation | 220 px | 380 px | Leave 520 px for editor plus the open context column. |
| Writing partner | 280 px | 720 px | Leave 520 px for editor plus the open navigation column. |

When the viewport changes, saved widths are constrained again. The values are written to `localStorage` as the user resizes.

### Input behavior

- Pointer drag resizes in the expected visual direction.
- Arrow keys resize by 16 px.
- `Home` moves to the minimum.
- `End` moves to the current dynamic maximum.
- Double-click resets to the responsive CSS default and removes the stored value.

The separator exposes `role="separator"`, its controlled column ID, orientation, and current/min/max values. Active pointer resizing sets a body class to retain the resize cursor and prevent text selection.

## Responsive drawers

[`ResponsiveDrawer`](../src/components/ResponsiveDrawer.tsx) provides both side drawers below desktop:

- semantic modal dialog with an accessible title;
- backdrop click and explicit close button;
- Escape-to-close;
- initial focus on the close button;
- Tab/Shift+Tab wrapping inside known focusable elements;
- focus restoration to the element active before opening;
- a narrow navigation width and a wider writing-partner width.

This is a local dialog implementation, not a general overlay framework. It does not mark the background `inert`, set `aria-hidden` on the application, or lock body scrolling. The main workspace already has fixed viewport height and hidden outer overflow, which limits background scrolling in the current page. Revisit these details if the page shell changes or the drawer is reused elsewhere.

## Header controls

[`DocumentHeader`](../src/components/DocumentHeader.tsx) uses separate controls for desktop columns and mobile drawers, each with the correct `aria-controls` and `aria-expanded` state.

When the writing partner is not visible, its toggle includes the unread count in both the visual badge and accessible label. When the desktop partner is already open, the header suppresses its unread badge because the count is visible in the dock.

Current functional controls:

- open/close navigation drawer;
- show/hide navigation desktop panel;
- open/close writing-partner drawer;
- show/hide writing-partner desktop panel.

Current presentation-only controls:

- Drafts / Review / Published tabs;
- history;
- Export;
- Share;
- overflow menu.

## Editor surface

[`DocumentEditor`](../src/components/DocumentEditor.tsx) is the only vertically scrolling center-region surface. It renders:

- a centered BlockNote editor with a maximum content width of 55rem;
- an absolute workspace-card layer over the full editor canvas;
- extra minimum canvas height when a workspace card extends beyond the document.

BlockNote receives explicit labels for the editor region and editable draft surface. The app supplies a custom light theme through CSS variables and uses:

- Inter for headings and interface text;
- Literata for paragraphs and preview content;
- large bottom padding to leave drafting space.

On small screens the editor's inline padding is reduced. The editor remains the primary page scroll container at all sizes.

## Suggestion dock interaction

The writing partner has two tabs, Suggestions and Activity. Its sticky toolbar also contains the lifecycle control, so **Start Agent** or **Stop Agent** remains available from either tab and suggestion detail.

The Suggestions tab has two mutually exclusive views:

- queue view: error, Pins, and live inbox;
- detail view: full suggestion, sources, visual content, and actions.

Selecting an item marks it viewed and scrolls the dock to the top. Unread live and pinned entries contribute to the count. Workspace cards do not.

The queue deliberately has no suggestion-type tabs. All kinds share one stream, with a badge identifying the kind. Pins are separated above the live inbox.

Action availability is constrained by lifecycle:

- Start Agent is disabled while Pi configuration is unavailable;
- Start and Stop are disabled while their IPC request is pending;
- stopping preserves existing suggestions and cancels active model work;
- only text kinds can preview;
- any active preview disables starting another;
- the active preview's source item cannot be dismissed or placed on the workspace;
- workspace placement appears only for pinned detail on desktop.

## Workspace card input and bounds

Workspace cards are desktop reference surfaces, not editor content. [`WorkspacePins`](../src/components/WorkspacePins.tsx) supports:

- pointer drag through the card header;
- pointer resize through the bottom-right handle;
- raising a card when it is interacted with;
- automatic clamping when canvas dimensions change;
- independently scrolling content inside a fixed card;
- returning a card to the Pins section.

Keyboard behavior on the move and resize buttons:

- arrow keys move or resize by 10 px;
- Shift+arrow uses a fine 1 px step;
- geometry remains clamped to the canvas.

The cards are inside a `pointer-events: none` overlay, while each card opts back into pointer events. This allows interaction with the editor in uncovered areas.

## Focus and semantics checklist

When changing UI behavior, retain these existing properties:

- icon-only buttons have explicit labels and decorative icons use `aria-hidden`;
- panel controls expose the controlled element and expanded state;
- drawers are named modal dialogs and restore focus;
- unread state is not color-only (`Unread` is exposed to assistive technology on queue rows);
- agent errors use readable text;
- agent lifecycle state and the pending Start/Stop label are exposed as text;
- a mind map has an accessible description even if rendering fails;
- workspace cards are named regions with named move, resize, and return controls;
- custom focus outlines are visible on buttons, links, and inputs;
- preview accept is unavailable when its content is empty.

## Styling conventions

Use Tailwind utilities in components for local layout and presentation. Add global CSS only when a selector must target third-party/editor markup, define shared tokens, or coordinate the workspace grid.

The brand palette is declared as `brand-50` through `brand-900` in [`index.css`](../src/index.css). BlockNote has a parallel set of `--bn-*` variables in the same file. When changing a core color, check both systems as well as hard-coded neutral colors in components.

There is a `dark` custom variant declaration, but the current app forces a light color scheme and does not implement theme switching.

## Static prototype surfaces

Do not infer application behavior from every button currently visible. The sidebar navigation, document-management actions, and tabs are static. Source upload is functional: `App` supplies persisted source data and an Electron import callback to `Sidebar`. When implementing the remaining controls, add an explicit state/data owner and update this documentation; avoid placing navigation or persistence side effects directly inside presentational components.
