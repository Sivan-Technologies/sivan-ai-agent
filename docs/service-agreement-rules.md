# Sivan Service Agreement Rules

Sivan is for lawful service-agreement coordination between clients and service providers. It must not be used for restricted goods, illegal services, crypto trading, weapons, violence, fraud, or regulated financial activity outside licensed payment-provider processing.

## Customer-Facing Positioning

Use these terms in customer-facing copy:

- Service agreement
- Agreement
- Client
- Service provider
- Payment processed through a licensed provider
- Payment reference
- Delivery proof
- Completion confirmation
- Issue review

Avoid these terms in customer-facing copy:

- Escrow
- Funds held
- Funds locked
- Release payment
- Secure payment holding
- Wallet balance
- Custody
- Custodial
- Payment guarantee
- Dispute holding system

Internal database, route, and TypeScript names may still use legacy names until a separate migration is planned. Do not expose those internal names in WhatsApp copy, landing pages, or support responses.

## Prohibited Agreement Terms

Reject or route to review any agreement purpose, description, delivery note, or support message that includes these categories.

### Illegal Drugs

- drugs
- cocaine
- heroin
- meth
- methamphetamine
- mdma
- ecstasy
- lsd
- opioids
- fentanyl
- weed
- marijuana
- cannabis
- skunk
- tramadol
- codeine

### Sexual Services

- hookup
- runs
- escort
- prostitute
- prostitution
- sex work
- adult service
- nudes
- onlyfans

### Weapons Or Violence

- gun
- guns
- pistol
- rifle
- ammo
- ammunition
- weapon
- weapons
- knife attack
- bomb
- explosive
- killing
- kill
- murder
- assassinate
- kidnap
- kidnapping
- hitman

### Crypto Or Digital-Asset Trading

- crypto
- cryptocurrency
- bitcoin
- btc
- ethereum
- eth
- usdt
- usdc
- bnb
- tron
- trx
- solana
- sol
- xrp
- ripple
- doge
- dogecoin
- litecoin
- ltc
- ton
- toncoin
- airdrop
- wallet
- seed phrase
- private key
- stablecoin
- token
- tokens
- coin
- coins
- nft
- defi
- dex
- binance
- bybit
- okx
- kucoin
- trust wallet
- metamask

### Fraud Or Regulated Financial Activity

- carding
- chargeback abuse
- stolen card
- bank log
- bank logs
- cashout
- cash out
- money laundering
- launder
- fake alert
- scam
- fraud
- forged
- fake id

## Bot Behavior

The WhatsApp bot should block restricted service descriptions before creating an agreement.

Recommended response:

```text
Sivan Bot: this service agreement cannot be created because the description appears to reference a restricted category.
Category: {category}

Use Sivan only for lawful service work such as design, development, marketing, logistics, repairs, or consulting.
```

## Provider Rules

- Sivan does not hold or store user funds.
- Payment must be processed by configured licensed payment providers.
- Sivan records payment references and delivery status for agreement tracking.
- Bank transfer is the only enabled Naira payment method.
- Crypto terms are blocked in the Nigeria MVP service-agreement flow.

