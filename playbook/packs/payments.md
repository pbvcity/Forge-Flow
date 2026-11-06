# Pack: payments

Read when a change touches charges, refunds, payouts, or balances. This is high tier. Prices, fees, refund limits, and rounding policy may be provisional in development. Record them, and confirm each before going live.

## Amounts

- [ ] The server recomputes every amount and decision. It ignores price, tier, discount, or approval fields sent by a client, and a test proves tampering fails.
- [ ] Money is stored in integer minor units, with the currency alongside.
- [ ] Totals are computed in one place, used by quote, order, and refund alike.

## Callbacks

- [ ] Signatures are verified before anything else is trusted.
- [ ] Handling is idempotent on the provider's event ID. Duplicates change nothing.
- [ ] Out-of-order events are safe: a late event cannot move an order backward.
- [ ] The amount and order reference are compared with your own record.
- [ ] A slow or failed downstream step does not lose the event. It is stored, then retried.
- [ ] Publishing to internal events is wired for real. A silent no-op on the bus has passed every review before.

## Provider responses

- Read the official doc for each endpoint. Require only fields it says it returns. Requiring an extra field can make a real refund record as failed.
- Do not reimplement the provider's own limits. Pass its error code through a clear message.

## Refunds

- [ ] Full, partial, repeated, and concurrent refunds keep the balance right.
- [ ] A refund cannot exceed what remains.
- [ ] Operators have an entry point for partial refunds and for orders stuck in between.
- [ ] Customers get the notification, and it contains no internal labels.

## Abuse and exposure

- [ ] Rate-limit keys hold behind the real proxy. If every request shares one IP, an IP limit lets anyone lock out all users.
- [ ] Logs hold no card data, tokens, or payment identifiers.
- [ ] Secrets stay out of URLs, client bundles, and error messages.

## Going live

- [ ] Run one real small-amount cycle end to end: pay, callback, order state, notification, refund, ledger. Sandbox results do not replace this, and many of the worst bugs only show here. The user usually has to do it, so give exact steps.
- [ ] A kill switch can turn the flow off without a deploy.
- [ ] A reconciliation report compares provider records with your own.
- [ ] An alert fires on failures, and someone receives it.
- [ ] Review the first real day of transactions read-only.

## Failure stance

Fail closed on money: when state is unclear, do not charge or refund twice. Record the case for a person to resolve, and keep unrelated orders moving.
