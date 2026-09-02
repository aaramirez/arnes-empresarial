import { describe, expect, it } from "vitest";
import { ACTIVIDAD_TIPO_PR_REVIEW } from "../../core/activity/activity-contract.js";
import { mapGithubEvent, ORIGEN_GITHUB } from "./github-mapper.js";
import pullRequestOpenedFixture from "./__fixtures__/pull-request.opened.json" with { type: "json" };
import issueCommentOnPrFixture from "./__fixtures__/issue-comment.on-pr.json" with { type: "json" };
import issueCommentOnIssueFixture from "./__fixtures__/issue-comment.on-issue.json" with { type: "json" };

const DELIVERY_ID = "72d3162e-cc78-11e3-81ab-4c9367dc0958";
const RECIBIDO_EN = "2026-08-30T14:02:15.000Z";

function withAction<T extends { action: string }>(fixture: T, action: string): T {
  return { ...fixture, action };
}

describe("mapGithubEvent — pull_request", () => {
  it("maps action 'opened' field by field against the §4.3 table", () => {
    const result = mapGithubEvent({
      eventName: "pull_request",
      payload: pullRequestOpenedFixture,
      deliveryId: DELIVERY_ID,
      recibidoEn: RECIBIDO_EN,
    });

    expect(result).toEqual({
      origen: ORIGEN_GITHUB,
      proyectoId: "octo-org/hello-world",
      proyectoNombre: "hello-world",
      repoUrl: "https://github.com/octo-org/hello-world",
      tipo: ACTIVIDAD_TIPO_PR_REVIEW,
      referenciaExterna: "42",
      responsableId: "octocat",
      titulo: "fix: corrige validacion de firma HMAC en el listener de webhooks",
      cuerpo: pullRequestOpenedFixture.pull_request.body,
      archivosCambiados: [],
      deliveryId: DELIVERY_ID,
      recibidoEn: RECIBIDO_EN,
    });
    expect(result?.comentarioDisparador).toBeUndefined();
  });

  it("maps action 'synchronize' to a valid event", () => {
    const payload = withAction(pullRequestOpenedFixture, "synchronize");

    const result = mapGithubEvent({
      eventName: "pull_request",
      payload,
      deliveryId: DELIVERY_ID,
      recibidoEn: RECIBIDO_EN,
    });

    expect(result).toBeDefined();
    expect(result?.referenciaExterna).toBe("42");
    expect(result?.tipo).toBe(ACTIVIDAD_TIPO_PR_REVIEW);
  });

  it("maps action 'reopened' to a valid event", () => {
    const payload = withAction(pullRequestOpenedFixture, "reopened");

    const result = mapGithubEvent({
      eventName: "pull_request",
      payload,
      deliveryId: DELIVERY_ID,
      recibidoEn: RECIBIDO_EN,
    });

    expect(result).toBeDefined();
    expect(result?.referenciaExterna).toBe("42");
    expect(result?.tipo).toBe(ACTIVIDAD_TIPO_PR_REVIEW);
  });

  it("ignores an unsupported action (e.g. 'closed') and returns undefined", () => {
    const payload = withAction(pullRequestOpenedFixture, "closed");

    const result = mapGithubEvent({
      eventName: "pull_request",
      payload,
      deliveryId: DELIVERY_ID,
      recibidoEn: RECIBIDO_EN,
    });

    expect(result).toBeUndefined();
  });
});

describe("mapGithubEvent — issue_comment", () => {
  it("maps a comment on an issue that IS a PR, with comentarioDisparador and responsableId = PR/issue author (not the commenter)", () => {
    const result = mapGithubEvent({
      eventName: "issue_comment",
      payload: issueCommentOnPrFixture,
      deliveryId: DELIVERY_ID,
      recibidoEn: RECIBIDO_EN,
    });

    expect(result).toBeDefined();
    expect(issueCommentOnPrFixture.issue.user.login).not.toBe(
      issueCommentOnPrFixture.comment.user.login,
    );
    expect(result).toEqual({
      origen: ORIGEN_GITHUB,
      proyectoId: "octo-org/hello-world",
      proyectoNombre: "hello-world",
      repoUrl: "https://github.com/octo-org/hello-world",
      tipo: ACTIVIDAD_TIPO_PR_REVIEW,
      referenciaExterna: "42",
      responsableId: "octocat",
      titulo: issueCommentOnPrFixture.issue.title,
      cuerpo: issueCommentOnPrFixture.issue.body,
      archivosCambiados: [],
      comentarioDisparador: issueCommentOnPrFixture.comment.body,
      deliveryId: DELIVERY_ID,
      recibidoEn: RECIBIDO_EN,
    });
  });

  it("returns undefined when the commented issue is NOT a PR (issue.pull_request absent)", () => {
    const result = mapGithubEvent({
      eventName: "issue_comment",
      payload: issueCommentOnIssueFixture,
      deliveryId: DELIVERY_ID,
      recibidoEn: RECIBIDO_EN,
    });

    expect(result).toBeUndefined();
  });
});

describe("mapGithubEvent — eventos e inputs invalidos", () => {
  it("returns undefined for an unknown event name (e.g. 'push')", () => {
    const result = mapGithubEvent({
      eventName: "push",
      payload: pullRequestOpenedFixture,
      deliveryId: DELIVERY_ID,
      recibidoEn: RECIBIDO_EN,
    });

    expect(result).toBeUndefined();
  });

  it("returns undefined without throwing for a malformed payload ({}, null, missing repository.full_name)", () => {
    expect(() =>
      mapGithubEvent({
        eventName: "pull_request",
        payload: null,
        deliveryId: DELIVERY_ID,
        recibidoEn: RECIBIDO_EN,
      }),
    ).not.toThrow();

    expect(
      mapGithubEvent({
        eventName: "pull_request",
        payload: null,
        deliveryId: DELIVERY_ID,
        recibidoEn: RECIBIDO_EN,
      }),
    ).toBeUndefined();

    expect(
      mapGithubEvent({
        eventName: "pull_request",
        payload: {},
        deliveryId: DELIVERY_ID,
        recibidoEn: RECIBIDO_EN,
      }),
    ).toBeUndefined();

    expect(
      mapGithubEvent({
        eventName: "pull_request",
        payload: {
          action: "opened",
          pull_request: pullRequestOpenedFixture.pull_request,
          repository: { name: "hello-world", html_url: "https://github.com/octo-org/hello-world" },
        },
        deliveryId: DELIVERY_ID,
        recibidoEn: RECIBIDO_EN,
      }),
    ).toBeUndefined();
  });
});
