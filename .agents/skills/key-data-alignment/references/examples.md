# Values and quotes, worked

Optional depth for `key-data-alignment`. The rules in `SKILL.md` decide the outcome; these examples show what they look like.

## A value is the value

The value is what the document asserts, with the sentence around it removed.

| Source sentence | Value |
|---|---|
| `The Client shall pay all undisputed invoices within 45 days of receipt.` | `45 days` |
| `The total contract value is USD 120000 including delivery and support.` | `USD 120000` |
| `Agreement between Northwind Analytics and Bright Harbor Ltd.` | `Northwind Analytics and Bright Harbor Ltd.` |
| `本合同总金额为人民币 100000 元。` | `100000 元` |
| `甲方应在收到发票后 60 天内支付全部款项。` | `60 天` |

Wrong, because the sentence is folded back in:

| Wrong value | Why |
|---|---|
| `within 45 days of receipt` | The qualifier belongs to the clause, not to the term. |
| `USD 120000 including delivery and support` | `including …` describes what the amount covers. |
| `Agreement between Northwind Analytics and Bright Harbor Ltd.` | The preamble is not part of the counterparty. |

## A quote is copied, not paraphrased

The quote is the sentence the value was taken from, character for character.

```
quote: "The Client shall pay all undisputed invoices within 45 days of receipt."
```

Not `the client pays within 45 days`, and not a sentence stitched together from two places. A quote that cannot be found in the source text costs the finding its evidence, and the finding is dropped.

## One item per key per document

A document that states two values for one key does not produce two items for that key. Keep the value the key names, and give the other one its own custom key if it matters.

| Document | Key | Value | Instead of |
|---|---|---|---|
| A | `confidentiality` | `all disclosed information` | `maintain confidentiality of all disclosed information` (the clause, not the scope) |
| A | `contract_subject` | `Northwind Analytics and Bright Harbor Ltd.` | one item for `Northwind Analytics` and another for `Bright Harbor Ltd.` |
| A | `contract_value` | `USD 120000` | `USD 120000` and `delivery and support` as two items |

## A key outside the vocabulary

When the document states something material that no key covers, use a short custom key in the same style — `delivery_acceptance_window`, not `The acceptance window described in clause 7`. Custom keys line up by exact name, so two documents have to name them the same way.
