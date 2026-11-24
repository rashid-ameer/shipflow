# Use separate Function input profiles for delivery customization scopes

Shopify evaluates a fixed input query for each Function, with a maximum query cost of 30. Basic and Advanced use separate Function bindings and share one evaluator so each can expose its checkout fields within that limit. Shopify preserves the original binding when a customization is updated, so ShipFlow retains one Shopify record per scope and activates at most one for each saved rule.
