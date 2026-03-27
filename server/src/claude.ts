/**
 * claude.ts — Claude CLI subprocess runner
 *
 * Calls the `claude` CLI as a subprocess, passing the prompt and returning the
 * text response. Uses CLAUDE_CODE_OAUTH_TOKEN for auth (same pattern as
 * agent-runner).
 *
 * TODO: For real Claude Code (developer agent), spawn a separate CC process
 *       with a working directory per project and capture file diffs rather
 *       than raw text output.
 */

export interface ClaudeRunOptions {
  systemPrompt: string;
  userPrompt: string;
  /** Max tokens to request. Defaults to 4096. */
  maxTokens?: number;
}

export interface ClaudeRunResult {
  content: string;
  /** True if we got real output from Claude; false if we used the mock fallback. */
  real: boolean;
}

/**
 * Run a one-shot Claude query via the CLI subprocess.
 *
 * The subprocess receives the full prompt over stdin and the response is read
 * from stdout.  If the CLI is unavailable (not installed, no token, etc.) we
 * fall back to a deterministic mock so the loop can keep running in dev.
 */
export async function runClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY;

  if (!token) {
    console.warn("[claude] No auth token found — using mock output");
    return { content: mockOutput(opts.userPrompt), real: false };
  }

  const fullPrompt = `${opts.systemPrompt}\n\n${opts.userPrompt}`;

  try {
    // Attempt to call the claude CLI with --print (non-interactive, single response)
    const proc = Bun.spawn(
      ["claude", "--print", "--dangerously-skip-permissions"],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          CLAUDE_CODE_OAUTH_TOKEN: token,
        },
      }
    );

    // Write prompt to stdin and close
    proc.stdin.write(fullPrompt);
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      console.warn(`[claude] CLI exited with code ${exitCode}: ${stderr.slice(0, 200)}`);
      return { content: mockOutput(opts.userPrompt), real: false };
    }

    const content = stdout.trim();
    if (!content) {
      console.warn("[claude] Empty response from CLI — using mock output");
      return { content: mockOutput(opts.userPrompt), real: false };
    }

    return { content, real: true };
  } catch (err) {
    console.warn("[claude] Failed to spawn CLI:", (err as Error).message);
    return { content: mockOutput(opts.userPrompt), real: false };
  }
}

/**
 * Mock output generator — produces plausible-looking agent output so the loop
 * can run end-to-end without a real Claude token in dev/test environments.
 * Extracts the project name/description from the prompt so each project gets
 * project-specific mock content instead of always writing about Ouro.
 *
 * TODO: Remove (or gate behind NODE_ENV=test) once real Claude integration is live.
 */
function mockOutput(userPrompt: string): string {
  const phase = detectPhase(userPrompt);
  const { name: projectName, description: projectDesc } = extractProjectBrief(userPrompt);
  const brief = projectDesc ? `${projectName} — ${projectDesc}` : projectName;

  const mocks: Record<string, string> = {
    research: `# Research Report: ${projectName}

## Summary
Preliminary research for **${brief}**.

## Competitors
| Name | Description | Relevant |
|------|-------------|---------|
| Competitor A | Direct market alternative | Yes — similar core feature set |
| Competitor B | Adjacent product | Partial — overlapping user base |
| Competitor C | Emerging player | Watch — growing fast |

## OSS / Libraries
| Library | Purpose | Verdict |
|---------|---------|---------|
| React | UI framework | ✅ Recommended |
| Tailwind CSS | Styling | ✅ Recommended |
| React Query | Data fetching | ✅ Recommended |
| Zustand | State management | ✅ Recommended for client state |

## UI Patterns
- Mobile-first responsive layout
- Real-time updates via WebSocket
- Optimistic UI for order/action flows

## Dev Patterns
- REST API with clear resource boundaries
- Event-driven updates for live data
- Role-based access (customer / restaurant / driver / admin)

## Risks
1. Real-time delivery tracking latency — mitigated by WebSocket with polling fallback
2. Concurrent order volume — mitigated by queue-based processing

## Recommendations
- Start with customer-facing flows then layer in restaurant and driver views
- Use optimistic UI for cart operations to feel instant
`,

    spec: `# Product Specification: ${projectName}

> **Project brief:** ${brief}

## User Stories

### US-001: Customer — Browse & Order
As a customer,
I want to browse restaurants and build an order,
So that I can get food delivered to my location.

**Acceptance Criteria:**
- Can view a list of restaurants with name, cuisine type, and estimated delivery time
- Can browse a restaurant menu and add items to cart
- Can review cart, adjust quantities, and place order
- Receives real-time status updates as order progresses

### US-002: Customer — Live Delivery Tracking
As a customer,
I want to track my delivery in real time,
So that I know when my food will arrive.

**Acceptance Criteria:**
- Order status updates live (Placed → Preparing → Out for Delivery → Delivered)
- Driver location visible on map once order is picked up
- Push notification or in-app alert on each status change

### US-003: Restaurant — Menu Management
As a restaurant owner,
I want to manage my menu and toggle item availability,
So that customers only see items I can fulfil.

**Acceptance Criteria:**
- Can add, edit, and remove menu items with name, description, price, and photo
- Can mark individual items as unavailable without deleting them
- Changes take effect immediately for new customer sessions

### US-004: Restaurant — Incoming Order Queue
As a restaurant operator,
I want to see and manage incoming orders,
So that I can confirm, prepare, and hand off orders efficiently.

**Acceptance Criteria:**
- New orders appear in real time with order details and customer notes
- Can accept or reject an order within a configurable timeout
- Can mark order as "Ready for Pickup" once prepared

### US-005: Driver — Delivery Queue
As a driver,
I want to see available deliveries near me,
So that I can pick up and deliver orders.

**Acceptance Criteria:**
- Can see a list of orders ready for pickup sorted by proximity
- Can accept a delivery and get navigation to the restaurant
- Can mark order as picked up and then as delivered

### US-006: Admin — Platform Management
As an admin,
I want to manage users, restaurants, and platform settings,
So that I can keep the platform running smoothly.

**Acceptance Criteria:**
- Can view and manage all users (customers, restaurants, drivers)
- Can suspend or reactivate accounts
- Can view platform-wide order metrics and revenue
`,

    design: `# Design Specification: ${projectName}

> **Project brief:** ${brief}

## User Flows

### Customer: Place an Order
1. Customer opens app, sees restaurant list filtered by location
2. Selects a restaurant, browses menu
3. Adds items to cart; cart badge updates
4. Reviews cart, confirms address, selects payment method
5. Places order — confirmation screen shown with order ID
6. Live tracking screen: status bar updates in real time

### Restaurant: Accept Incoming Order
1. New order arrives — audio alert + toast notification
2. Operator reviews order details in the queue panel
3. Clicks "Accept" — customer notified, timer starts for preparation
4. Clicks "Ready" when order is bagged — driver notified

### Driver: Pick Up & Deliver
1. Driver sees available pickup notification
2. Accepts delivery, gets navigation to restaurant
3. Marks "Picked Up" on arrival — customer tracking activates
4. Navigates to customer, marks "Delivered"

## Component Tree
\`\`\`
App
├── CustomerApp
│   ├── RestaurantListPage
│   │   ├── SearchBar
│   │   ├── FilterChips (cuisine, price, ETA)
│   │   └── RestaurantCard[]
│   ├── MenuPage
│   │   ├── MenuCategoryNav
│   │   ├── MenuItem[]
│   │   └── CartSidebar
│   ├── CheckoutPage
│   └── TrackingPage
│       ├── StatusProgressBar
│       └── MapView
├── RestaurantApp
│   ├── OrderQueuePanel
│   │   └── OrderCard[]
│   └── MenuManagerPage
├── DriverApp
│   ├── AvailableDeliveriesPanel
│   └── ActiveDeliveryView
└── AdminApp
    ├── UserManagementTable
    └── MetricsDashboard
\`\`\`

## Layout Specs
- Mobile-first: 375px base, responsive up to 1440px
- Customer app: bottom nav on mobile, sidebar on desktop
- Restaurant/Driver/Admin: desktop-first dashboard layout
- Colour palette: warm orange primary, white background, dark text

## Component Specs

### RestaurantCard
- Photo thumbnail (16:9), restaurant name, cuisine tags, star rating, ETA badge
- Hover: subtle elevation shadow

### OrderCard (Restaurant queue)
- Order ID, customer name, items summary, total, elapsed time badge
- CTA buttons: Accept / Reject / Ready — colour coded
`,

    build: `# Implementation Plan: ${projectName}

> **Project brief:** ${brief}

## File Structure
\`\`\`
server/
  src/
    index.ts          ← Express/Elysia app + routes
    db.ts             ← Schema + typed queries
    routes/
      customers.ts
      restaurants.ts
      orders.ts
      drivers.ts
      admin.ts
    services/
      orderService.ts   ← Order lifecycle state machine
      trackingService.ts ← Real-time location updates
    ws/
      orderEvents.ts    ← WebSocket event broadcasting
client/
  src/
    apps/
      CustomerApp.tsx
      RestaurantApp.tsx
      DriverApp.tsx
      AdminApp.tsx
    components/
    hooks/
    store/
\`\`\`

## Key Data Shapes
\`\`\`typescript
interface Order {
  id: string;
  customerId: string;
  restaurantId: string;
  driverId: string | null;
  items: OrderItem[];
  status: "placed" | "confirmed" | "preparing" | "ready" | "in_transit" | "delivered";
  total: number;
  createdAt: number;
}
\`\`\`

## API Contract
- \`POST /api/orders\` — place order
- \`PATCH /api/orders/:id/status\` — update order status (restaurant/driver/system)
- \`GET /api/restaurants\` — list restaurants with menu counts
- \`WS /ws/orders/:id\` — live order status stream

## Commit Plan
- feat(db): orders, restaurants, drivers schema
- feat(orders): order placement and state machine
- feat(ws): real-time order status broadcasting
- feat(client/customer): browse, cart, checkout, tracking
- feat(client/restaurant): order queue, menu management
- feat(client/driver): delivery queue and active delivery
`,

    test: `# Test Report: ${projectName}

> **Project brief:** ${brief}

### US-001: Customer — Browse & Order

| Test | Status | Notes |
|------|--------|-------|
| Customer can view restaurant list | ✅ PASS | |
| Customer can add items to cart | ✅ PASS | |
| Customer can place an order | ✅ PASS | Returns order ID |
| Customer receives order confirmation | ✅ PASS | |

### US-002: Customer — Live Delivery Tracking

| Test | Status | Notes |
|------|--------|-------|
| Order status updates in real time via WS | ✅ PASS | |
| Status bar reflects each stage | ✅ PASS | |
| Driver location visible once in transit | ⚠️ FAIL | Map integration stub only — see GH#1 |

### US-003: Restaurant — Menu Management

| Test | Status | Notes |
|------|--------|-------|
| Can add a menu item | ✅ PASS | |
| Can mark item unavailable | ✅ PASS | |
| Unavailable items hidden from customers | ✅ PASS | |

### US-004: Restaurant — Incoming Order Queue

| Test | Status | Notes |
|------|--------|-------|
| New order appears in queue in real time | ✅ PASS | |
| Accept/reject updates order status | ✅ PASS | |
| Ready action notifies driver queue | ✅ PASS | |

### US-005: Driver — Delivery Queue

| Test | Status | Notes |
|------|--------|-------|
| Driver sees orders ready for pickup | ✅ PASS | |
| Accept delivery locks it to driver | ✅ PASS | |
| Mark delivered completes order lifecycle | ✅ PASS | |

## Raised Issues

### GH#1: Map integration not implemented
**Severity:** High
**Fix:** Integrate a maps SDK (e.g. Mapbox or Google Maps) for driver location tracking
`,

    review: `# Cycle Review: ${projectName}

> **Project brief:** ${brief}

## Summary

Cycle 1 complete. All 6 phases ran for **${projectName}**. Core flows are specced, designed, and planned.

## Decisions Made This Cycle
- Architecture: separate app views per role (customer / restaurant / driver / admin)
- Real-time: WebSocket for order status and driver location
- State machine: order lifecycle modelled as explicit status enum

## Patterns Established
- Role-based routing at the app entry point
- Optimistic UI for cart and order placement
- WS event naming: \`order:status_changed\`, \`order:driver_assigned\`

## Next Cycle Priorities
1. Implement map SDK integration for driver tracking (GH#1)
2. Add payment provider integration (Stripe)
3. Build push notification system for order updates
4. Implement restaurant onboarding flow
`,
  };

  return mocks[phase] ?? `# Agent Output\n\nTask completed for **${projectName}**.\n\nPhase: ${phase}\n\nThis is mock output. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN to use real Claude.`;
}

/**
 * Extract project name and description from the context block injected into
 * every agent prompt by buildContextBlock().
 */
function extractProjectBrief(prompt: string): { name: string; description: string } {
  const nameMatch = prompt.match(/^Project:\s*(.+)$/m);
  const descMatch = prompt.match(/^Description:\s*(.+)$/m);
  return {
    name: nameMatch ? nameMatch[1].trim() : "Unknown Project",
    description: descMatch ? descMatch[1].trim() : "",
  };
}

function detectPhase(prompt: string): string {
  // Extract the "Phase:" line from the context block — this is the most reliable signal.
  // Scanning the full prompt is unreliable because feed messages from earlier phases
  // contain phase-related keywords that pollute detection.
  const phaseMatch = prompt.match(/^Phase:\s*(\w+)/m);
  if (phaseMatch) {
    const p = phaseMatch[1].toLowerCase();
    if (["research", "spec", "design", "build", "test", "review"].includes(p)) return p;
  }

  // Fallback: scan just the TASK section (after the context block ends)
  const taskSection = prompt.split("TASK:").pop() ?? prompt;
  const lower = taskSection.toLowerCase();
  if (lower.includes("research")) return "research";
  if (lower.includes("user stor") || lower.includes("acceptance criteria")) return "spec";
  if (lower.includes("design") || lower.includes("user flow")) return "design";
  if (lower.includes("implement") || lower.includes("file structure")) return "build";
  if (lower.includes("test report") || lower.includes("playwright")) return "test";
  if (lower.includes("claude.md") || lower.includes("decisions made")) return "review";
  return "research";
}
