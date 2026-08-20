# Clarifying questions

1. How should a recipient's share be expressed: a percentage, a fixed amount, or a relative weight (for example, `1` and `2` meaning one-third and two-thirds)?
2. Is a recipient's share set separately for each invoice type, or separately for every individual invoice?
3. Which invoice types should exist initially, and should the admin be able to add, rename, or remove types?
4. What makes a month's invoice set “complete”: exactly one invoice for every configured type, or should the admin mark the month as complete manually?
5. Can a month contain multiple invoices of the same type, and should the admin be able to edit or delete an invoice after adding it?
6. When shares or recipients change, should past months keep their original calculations, or be recalculated using the latest setup?
7. What should the public feed show: every invoice amount, each person's amount owed, and/or only the final monthly totals?
8. Should the app only calculate amounts owed, or also let the admin record who has paid?
9. Is a single shared admin password sufficient, with the public feed accessible to anyone on the local network who knows its address?


# Answers
1. Relative weight
2. Yes, separate. Also not every recipient has to be connected to all of the invoices
3. Yes, the admin is the one to add or remove named types. Initially there can be this set (Electricity, Water, Gas, Internet)
4. All of the types for the month are input, then it's completed
5. One type per month. It should be possible to remove the entries by the admin
6. This won't happen to often, but it should not be recalculated. The future calculations will be the only affected.
7. Every invoice entry, so it's clear for everyone how much the houshold pays. Whet each person owes, and monthly totals.
8. Only calculations for now, no payment tracking
9. Yes, a hardoced admin password is enough. The feed is public for everyone on the local network.