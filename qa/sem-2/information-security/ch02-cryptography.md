## Q1. What is cryptography? Explain its goals.
Marks: 5

**Cryptography** is the science of protecting information by transforming it into a form that unauthorised people cannot read or alter. Plain text is converted to cipher text by *encryption* and recovered by *decryption*, using a key.

The main goals are:

- **Confidentiality** – only authorised parties can read the data.
- **Integrity** – the data has not been changed in transit.
- **Authentication** – the sender and receiver are who they claim to be.
- **Non-repudiation** – a sender cannot later deny having sent a message.

> **Remember:** the four goals are easy to recall as C-I-A-N: Confidentiality, Integrity, Authentication, Non-repudiation.

## Q2. Differentiate between symmetric and asymmetric cryptography.
Marks: 10

Symmetric cryptography uses **one shared secret key** for both encryption and decryption. Asymmetric cryptography uses a **key pair**: a public key to encrypt and a private key to decrypt.

| Point | Symmetric | Asymmetric |
|---|---|---|
| Keys | One shared key | Public + private pair |
| Speed | Fast | Slow (heavy mathematics) |
| Key distribution | Hard: the key must be shared securely | Easy: the public key can be published |
| Typical use | Bulk data encryption | Key exchange, digital signatures |
| Examples | AES, DES, 3DES | RSA, ECC, Diffie-Hellman |

### Why both are used together
In practice a **hybrid** approach is used. An asymmetric algorithm securely exchanges a session key, then a symmetric algorithm encrypts the actual data quickly. TLS works this way.

> **Remember:** symmetric uses the same key both ways; asymmetric uses two different keys.

## Q3. Explain the Caesar cipher with an example.
Marks: 5

The **Caesar cipher** is a substitution cipher in which every letter is shifted by a fixed number of positions in the alphabet. With shift `k`:

- Encryption: `C = (P + k) mod 26`
- Decryption: `P = (C - k) mod 26`

**Example (k = 3):** the plain text `HELLO` becomes `KHOOR`.

```python
def caesar(text, k):
    out = ""
    for ch in text.upper():
        if ch.isalpha():
            out += chr((ord(ch) - 65 + k) % 26 + 65)
        else:
            out += ch
    return out

print(caesar("HELLO", 3))   # KHOOR
```

It is very weak: there are only 25 usable keys, so it is broken by brute force or frequency analysis.

## Q4. Describe the working of the RSA algorithm.
Marks: 10

RSA is an asymmetric algorithm whose security rests on the difficulty of **factoring the product of two large primes**.

### Key generation
1. Choose two large primes `p` and `q`.
2. Compute `n = p × q`.
3. Compute `φ(n) = (p − 1)(q − 1)`.
4. Choose `e` such that `1 < e < φ(n)` and `gcd(e, φ(n)) = 1`.
5. Compute `d` such that `d × e ≡ 1 (mod φ(n))`.
6. Public key is `(e, n)`; private key is `(d, n)`.

### Encryption and decryption
- Encrypt: `C = M^e mod n`
- Decrypt: `M = C^d mod n`

### Small example
Take `p = 3`, `q = 11`, so `n = 33` and `φ(n) = 20`. Choose `e = 7`; then `d = 3` because `7 × 3 = 21 ≡ 1 (mod 20)`. For `M = 4`: `C = 4^7 mod 33 = 16`, and `16^3 mod 33 = 4`, recovering the message.

> **Remember:** encrypt with the *receiver's public key* for confidentiality; sign with the *sender's private key* for authenticity.

## Q5. What are the types of cryptographic attacks?
Marks: 5

Attacks are classified by how much the attacker knows or controls:

- **Ciphertext-only attack** – the attacker has only cipher text.
- **Known-plaintext attack** – the attacker has some plain text and its cipher text.
- **Chosen-plaintext attack** – the attacker can encrypt plain text of their choice.
- **Chosen-ciphertext attack** – the attacker can decrypt cipher text of their choice.
- **Brute-force attack** – every possible key is tried.
- **Man-in-the-middle attack** – the attacker secretly sits between two parties and relays or alters messages.

## Q6. Explain the Diffie-Hellman key exchange.
Marks: 10

**Diffie-Hellman (DH)** lets two parties agree on a shared secret key over an insecure channel without ever sending the key itself. Its security rests on the **discrete logarithm problem**.

### Steps
1. Alice and Bob publicly agree on a prime `q` and a primitive root `α` of `q`.
2. Alice picks a private number `Xa` and sends `Ya = α^Xa mod q`.
3. Bob picks a private number `Xb` and sends `Yb = α^Xb mod q`.
4. Alice computes `K = Yb^Xa mod q`.
5. Bob computes `K = Ya^Xb mod q`.

Both obtain the same key `K = α^(Xa·Xb) mod q`.

### Example
With `q = 23`, `α = 5`, `Xa = 6`, `Xb = 15`: `Ya = 8`, `Yb = 19`, and both compute `K = 2`.

### Weakness
DH alone does not authenticate the parties, so it is vulnerable to a **man-in-the-middle attack**. It is combined with digital signatures or certificates to prevent this.

> **Remember:** DH is a *key exchange* protocol. It does not encrypt data or provide authentication by itself.
