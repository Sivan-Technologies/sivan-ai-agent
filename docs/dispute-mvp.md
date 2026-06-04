# Sivan MVP Dispute Operations Policy

This document defines Sivan's manual dispute process for the controlled MVP pilot.

It is an engineering and operations policy, not legal advice. A Nigerian fintech lawyer must review the final customer-facing terms, funds-flow structure, dispute language, and payment-provider agreements before Sivan handles significant real-money volume.

## Policy Position

For the first 200 users, every dispute must be decided manually by an authorized Sivan operator.

```text
AI may collect, organize, summarize, and flag evidence.
AI must never decide a dispute or move funds.
```

The operating priority is to avoid releasing funds to the wrong party. A delayed, documented decision is safer than an immediate incorrect payout.

## MVP Status

| Control | Status | Current position |
| --- | --- | --- |
| Participant opens dispute | ✅ Implemented | Buyer or seller can open a dispute through the private API or WhatsApp command |
| Immediate disputed state | ✅ Implemented | Escrow moves to `DISPUTED` |
| Release blocked while disputed | ✅ Implemented | Normal release cannot continue from `DISPUTED` |
| Participant evidence submission | ✅ Implemented | Buyer and seller can submit evidence privately |
| Admin evidence capture | ✅ Implemented | Admin Disputes view and protected API can record evidence |
| Linked support case | ✅ Implemented | Disputes can be tracked through support operations |
| Manual admin resolution | ✅ Implemented | Admin can record release, refund, cancellation, or no-action closure |
| Audit history | ✅ Implemented | Dispute opening, evidence, resolution, transactions, and support notes are recorded |
| Participant notifications | ✅ Implemented for MVP | Resolution/evidence notifications can be sent when enabled |
| Provider-side refund execution proof | 🟡 Operator-controlled | System records a manual refund outcome/reference; operator must independently execute and verify the provider refund |
| Maker-checker approval | 🔴 Not implemented | One authorized admin can currently record a resolution; dual approval is required before higher-value production use |
| Partial refund plus partial release | 🔴 Not supported | Do not promise or attempt split outcomes until accounting, reconciliation, and approval controls exist |
| AI dispute decision | ⛔ Prohibited for MVP | Intentionally not implemented |

Legend: ✅ implemented, 🟡 operational control required, 🔴 not implemented, ⛔ prohibited.

## Scope

This policy applies to the first controlled pilot and covers:

- Naira escrow disputes
- buyer and seller evidence collection
- internal manual review
- release-to-seller decisions
- refund-to-buyer decisions
- unfunded cancellation
- no-action closure

This policy does not authorize:

- automated dispute decisions
- partial refunds
- partial seller releases
- collection of government identity documents through ordinary WhatsApp messages
- provider-side refunds or payouts without recorded proof
- unrestricted high-value escrow disputes

## Dispute Opening And Fund Freeze

Either escrow participant may open a dispute using:

```text
dispute SIV-... reason
```

When a valid participant opens a dispute:

```text
Eligible active escrow
  -> DISPUTED
  -> stop release
  -> stop payout approval
  -> stop refund automation
  -> create or link support case
  -> request evidence from both parties
```

No payout, refund, cancellation, or other funds movement may occur while review is active unless an authorized operator records a final decision and completes the required finance verification.

### Operator Opening Checklist

1. Confirm the escrow ID and participant identities.
2. Confirm the escrow is now `DISPUTED`.
3. Confirm payment status, amount received, and payment reference.
4. Confirm no seller payout has already occurred.
5. Confirm the linked support case exists.
6. Notify both parties that funds are frozen during review.
7. Record the evidence deadline and assigned operator.

## Evidence Collection

Evidence must be submitted privately. Sensitive evidence must never be requested or posted in a WhatsApp group.

### Request From Buyer

- what was agreed
- what was received
- what is missing, defective, or disputed
- relevant screenshots or chat records
- payment proof, where relevant
- requested outcome

### Request From Seller

- what was agreed
- what was delivered
- delivery date and method
- relevant screenshots, files, or chat records
- proof of acceptance or completion, where available
- requested outcome

### Evidence Rules By Transaction Type

| Transaction type | Preferred objective evidence |
| --- | --- |
| Digital service | Agreed scope, delivery link/file, timestamps, revision history, acceptance messages |
| Freelance work | Scope, milestones, submitted work, revision requests, completion confirmation |
| Physical goods | Product description, tracking number, carrier status, delivery confirmation, condition evidence |
| Event or appointment | Booking terms, attendance evidence, cancellation terms, communications |

### Evidence Safety Rules

- Store evidence summaries and approved secure links, not unnecessary raw personal data.
- Do not request BVN, NIN, passwords, PINs, OTPs, full card details, secret keys, or webhook signatures.
- Do not request government ID through ordinary WhatsApp messages.
- Redact unrelated third-party personal data where practical.
- Treat screenshots as supporting evidence, not automatically conclusive evidence.
- Record who submitted each item and when it was received.

## Deadlines And Service Targets

Recommended pilot targets:

| Event | Target |
| --- | --- |
| Dispute acknowledgement | Immediately after valid dispute opening |
| Evidence submission window | 48 hours for each party |
| Initial operator review | Within 24 hours after evidence closes |
| Target decision | Within 72 hours after evidence closes |
| High-risk/provider investigation | Documented extension as required |

These are service targets, not guaranteed legal deadlines. Operators may extend a review for suspected fraud, payment-provider delays, high-value cases, missing evidence, safety concerns, or legal escalation. Every extension must be recorded and communicated to both parties.

## Manual Resolution Matrix

| Situation | MVP decision |
| --- | --- |
| Seller did not deliver and evidence supports buyer | Refund buyer |
| Seller delivered the agreed scope and evidence supports seller | Release seller |
| Escrow was never funded | Cancel with `cancel_no_funds` |
| Evidence is unclear or incomplete | Keep disputed and continue manual review |
| Fraud or account compromise is suspected | Freeze, escalate, and investigate |
| Parties privately agree to a split | Keep disputed; do not execute a partial outcome until split accounting is implemented |

The current supported resolution outcomes are:

```text
release_to_seller
refund_buyer
cancel_no_funds
no_action_close
```

### Unsupported Partial Outcomes

Sivan must not promise or record partial refunds during the MVP.

Partial refund plus partial release requires:

- separate payout and refund amounts
- split ledger entries
- separate provider references
- fee recalculation
- reconciliation checks
- participant agreement records
- maker-checker approval
- tested recovery procedures

Until those controls exist, an agreed partial outcome must remain in manual review or be handled only under counsel-approved external arrangements.

## Operator Decision Checklist

Before recording a decision, the operator must confirm:

1. The operator has no conflict of interest.
2. The escrow remains `DISPUTED`.
3. Buyer and seller had a reasonable opportunity to submit evidence.
4. Payment amount and provider reference were reconciled.
5. No payout or refund has already occurred.
6. The agreed scope and timeline were identified.
7. Evidence from both parties was reviewed.
8. Missing or contradictory evidence was recorded.
9. The reason for the decision is specific and understandable.
10. Any high-value escalation requirement was completed.
11. The intended financial action and responsible finance operator are recorded.
12. Participant notification wording contains no unnecessary sensitive information.

## Decision And Money Movement

A dispute decision and the resulting money movement are separate operational actions.

```text
Dispute operator records decision
  -> finance operator executes release or refund
  -> provider reference and amount are verified
  -> transaction and ledger records are confirmed
  -> participants receive final notification
```

### Release To Seller

- A Naira seller release requires a payout reference.
- Confirm the payout account remains verified and masked in operator views.
- Confirm the paid amount matches the approved escrow-derived amount.
- Record the payout reference before marking the financial action complete.

### Refund To Buyer

- Confirm no seller payout exists.
- Execute the refund through the approved Paystack, bank, or finance workflow.
- Verify the actual refund amount and provider reference.
- Record the reference in the dispute resolution, support notes, transaction record, and reconciliation process.
- Do not treat the internal `manual_refund_recorded` transaction as provider-side refund proof by itself.

### Maker-Checker Requirement

Before higher-value production use, implement:

```text
Decision maker
  -> records proposed outcome and reason
Checker/finance approver
  -> independently confirms evidence, amount, and destination
  -> authorizes or rejects money movement
```

Until maker-checker is implemented:

- keep disputed amounts within the controlled pilot limit
- require a second human to verify higher-risk decisions outside the application
- record the second review in support notes

## Value-Based Escalation

Recommended pilot policy:

| Disputed amount | Required review |
| ---: | --- |
| Up to ₦250,000 | Standard manual review |
| ₦250,001–₦500,000 | Senior operator review and direct contact with both parties |
| Above ₦500,000 | Do not process during the initial pilot without provider approval, legal review, enhanced verification, and senior approval |

High-risk cases require escalation regardless of amount when:

- account compromise is suspected
- identity or payout account inconsistencies exist
- payment reference or amount does not reconcile
- evidence appears manipulated
- either party has repeated disputes or abuse signals
- legal threats or law-enforcement requests are received

## AI Usage Policy

AI may assist operators by:

- organizing evidence by date and source
- summarizing participant claims
- identifying missing evidence
- highlighting contradictions for human review
- drafting neutral follow-up questions

AI must not:

- decide which participant is truthful
- assign the final outcome
- release or refund funds
- generate false certainty from incomplete evidence
- communicate a final decision without operator approval

All AI-generated summaries must be treated as drafts and checked against original evidence.

## Customer-Facing Legal Position

Do not describe Sivan as the final legal arbitrator without counsel approval.

Recommended concept for legal review:

> Sivan performs an internal operational dispute review based on available evidence. Users authorize Sivan to temporarily hold funds and record an operational release or refund decision, subject to applicable law, payment-provider requirements, and any external dispute-resolution rights.

Customer terms should clearly disclose:

- Sivan's role and limitations
- when funds may be frozen
- evidence submission rules
- decision and review process
- fees and refund treatment
- complaint and escalation channels
- applicable law and external dispute rights
- privacy, retention, and data-sharing practices

Obtain written confirmation from payment providers that Sivan's intended escrow-like funds flow and dispute-controlled release process are permitted.

## Records And Audit Requirements

Every dispute file should include:

```text
escrow_id
opened_at
opened_by
opening_reason
assigned_operator
buyer_evidence
seller_evidence
payment_reference
payment_amount
payout_or_refund_reference
decision
decision_reason
decision_maker
second_reviewer
resolved_at
participant_notifications
linked_support_case
```

Retention periods, deletion procedures, lawful basis, participant access rights, and cross-border processing must be reviewed under the Nigeria Data Protection Act and approved by counsel.

## Pilot Metrics

Review these metrics after the first 50–100 escrows and after every dispute:

- dispute rate
- average evidence response time
- average resolution time
- percentage released, refunded, cancelled, or unresolved
- repeated disputes by participant
- payment or payout reconciliation failures
- complaints after resolution
- operator errors or policy exceptions
- common dispute categories

Use real pilot evidence before building advanced fraud rules or dispute automation.

## Next Engineering Work

1. ✅ Keep all MVP dispute decisions manual.
2. ✅ Keep `DISPUTED`, evidence capture, support cases, manual outcomes, notifications, and audit history.
3. 🟡 Add provider-side refund execution verification and reconciliation proof.
4. 🟡 Add maker-checker approval before higher-value production disputes.
5. 🟡 Add dispute deadlines, assignment, and escalation visibility to the admin workflow.
6. 🔴 Add partial refund/release only after split accounting and reconciliation are designed and tested.
7. ⛔ Do not build AI dispute decisions during the controlled MVP.

## Legal And Provider Review Checklist

Before significant live volume:

- obtain Nigerian fintech counsel review
- obtain Paystack or payment-provider written approval for the intended funds flow
- approve customer terms and privacy notice
- approve dispute and complaint escalation language
- confirm refund and payout operating procedures
- confirm data retention and deletion rules
- confirm whether any licence, partnership, or regulated entity structure is required

## Sources

- Paystack Terms and Merchant Services Agreement: https://paystack.com/terms
- Nigeria Data Protection Act, 2023: https://ndpc.gov.ng/download/nigeria-data-protection-act-2023/
- Central Bank of Nigeria Consumer Protection: https://www.cbn.gov.ng/Documents/ConsumerProtection.html

