import { expect, test } from "@playwright/test";

const models = {
  models: [
    {
      id: "vendor/model-a",
      name: "Model A",
      contextLength: 128000,
      pricing: { prompt: "0.1", completion: "0.2" },
    },
    {
      id: "vendor/model-b",
      name: "Model B",
      contextLength: 64000,
      pricing: null,
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/models", (route) => route.fulfill({ json: models }));
});

test("shows the eight-seat arena setup with V1 defaults", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "The village is waiting." }),
  ).toBeVisible();
  await expect(page.getByLabel("Player name")).toHaveCount(8);
  await expect(page.getByLabel("OpenRouter model")).toHaveCount(8);
  await expect(page.getByText("2 models available")).toBeVisible();
  await expect(page.getByLabel("Reveal roles on departure")).not.toBeChecked();
  await expect(page.getByLabel("Exiled player final words")).toBeChecked();
  await expect(page.getByLabel("One Werewolf re-proposal")).not.toBeChecked();
  await expect(page.getByLabel("Allow vote abstention")).not.toBeChecked();

  const selectedModels = await page
    .getByLabel("OpenRouter model")
    .evaluateAll((selects) =>
      selects.map((select) => (select as HTMLSelectElement).value),
    );
  expect(new Set(selectedModels)).toEqual(new Set(["vendor/model-a"]));
});

test("blocks case-insensitive duplicate player names", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("2 models available")).toBeVisible();
  const names = page.getByLabel("Player name");
  await names.nth(1).fill("aSH");
  await expect(page.getByText("Name already in use")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: /Begin at Night 0/ }),
  ).toBeDisabled();
});

test("switches theme and remembers it after reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("saves and clears an OpenRouter key for the server session", async ({
  page,
}) => {
  await page.request.delete("/api/settings/openrouter");
  await page.goto("/settings");
  await expect(page.getByText("API key required")).toBeVisible();

  const input = page.getByLabel("OpenRouter API key");
  await input.fill("sk-or-v1-playwright-secret");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText("API key configured")).toBeVisible();
  await expect(
    page.getByText("Verified and saved for this server session."),
  ).toBeVisible();
  await expect(input).toHaveValue("");

  await page.reload();
  await expect(page.getByText("API key configured")).toBeVisible();
  await page.getByRole("button", { name: "Clear session key" }).click();
  await expect(page.getByText("API key required")).toBeVisible();
});

test("creates, controls, and reopens a deterministic game", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.goto("/");
  await expect(page.getByText("2 models available")).toBeVisible();
  let createPayload: unknown;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/games") && request.method() === "POST") {
      createPayload = request.postDataJSON();
    }
  });
  await page.getByRole("button", { name: /Begin at Night 0/ }).click();
  await expect(page).toHaveURL(/\/games\//, { timeout: 15_000 });
  await page.getByText("House rules for this game").click();
  await expect(page.locator(".house-rules dl")).toContainText(
    "Reveal roles on departureOff",
  );
  await expect(page.locator(".house-rules dl")).toContainText(
    "Exiled player final wordsOn",
  );
  const gameId = new URL(page.url()).pathname.split("/").at(-1)!;
  const replayedCreate = await page.request.post("/api/games", {
    data: createPayload,
  });
  expect(replayedCreate.status()).toBe(200);
  expect(await replayedCreate.json()).toMatchObject({ gameId });

  await page.getByRole("button", { name: "Pause after action" }).click();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  const hiddenBefore = await page.locator(".private-log article").count();
  await page.getByRole("button", { name: "Step next action" }).click();
  await expect
    .poll(() => page.locator(".private-log article").count())
    .toBeGreaterThan(hiddenBefore);
  await expect(
    page.getByText("Reasoning & request details").first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause after action" }).click();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();

  const gameUrl = page.url();
  await expect(page.getByRole("link", { name: "Main page" })).toBeVisible();
  await expect(page.locator(".table-panel .panel-heading > p")).toHaveText(
    /^(?:Day|Night) \d+$/,
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Ongoing games" }),
  ).toBeVisible();
  const resumeLink = page.locator(`a[href="/games/${gameId}"]`, {
    hasText: "Resume game",
  });
  await expect(resumeLink).toBeVisible();
  await resumeLink.click();
  await expect(page).toHaveURL(gameUrl);

  await page.goto("/history");
  await expect(page.getByText("Saved games.")).toBeVisible();
  await expect(
    page
      .getByText("Ash · Briar · Cinder · Dove · Ember · Flint · Gale · Hollis")
      .first(),
  ).toBeVisible();
  await page.goto(gameUrl);
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /Seer investigates|Doctor chooses protection|Werewolves choose a target/,
    }),
  ).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "End game" }).click();
  await expect(page.getByText("Game ended by operator").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume" })).toBeDisabled();

  await page.goto("/history");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: `Delete saved game ${gameId}` })
    .click();
  await expect(
    page.getByRole("button", { name: `Delete saved game ${gameId}` }),
  ).toHaveCount(0);
});
