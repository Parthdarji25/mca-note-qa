## Q1. What are the key principles of security? Explain each with an example.
Marks: 5

Security means protecting information and systems from unauthorised access, change or destruction. Six key principles define what "secure" means.

### 1. Confidentiality
Only the sender and the intended receiver should be able to read the message. It is broken by **interception**, where an attacker reads data they should not see.

- **Example:** someone steals your bank login details from an email.
- **Achieved by:** encryption, access permissions.

### 2. Authentication
The identity of a user or system is verified, so the receiver knows who really sent a message. It is broken by **fabrication**, where an attacker pretends to be someone else.

- **Example:** a fake email that claims to come from your bank.
- **Achieved by:** passwords, OTP, biometrics, digital certificates.

### 3. Integrity
The content of a message must not change between sender and receiver. It is broken by **modification**, where data is altered on the way.

- **Example:** an attacker changes a transfer amount from ₹100 to ₹10,000.
- **Achieved by:** hash functions, message digests, MAC.

### 4. Non-repudiation
A sender cannot later deny having sent a message, and a receiver cannot deny receiving it.

- **Example:** a customer orders a product online, then falsely claims they never placed the order.
- **Achieved by:** digital signatures.

### 5. Access control
Decides who can access what, and what they are allowed to do with it (read, write, execute).

- **Example:** a student can view marks but only a teacher can change them.
- **Achieved by:** role management, access control lists (ACL), rule management.

### 6. Availability
Resources and information must be available to authorised users whenever they need them. It is broken by **interruption**.

- **Example:** a Denial of Service (DoS) attack crashes a college website during results.
- **Achieved by:** backups, redundancy, firewalls, DoS protection.

### Summary

| Principle | Protects against | Attack type | Mechanism |
|---|---|---|---|
| Confidentiality | Unauthorised reading | Interception | Encryption |
| Authentication | Fake identity | Fabrication | Passwords, certificates |
| Integrity | Unauthorised change | Modification | Hashing, MAC |
| Non-repudiation | Denying an action | — | Digital signature |
| Access control | Misuse of resources | — | ACL, roles |
| Availability | Service disruption | Interruption | Backups, redundancy |

> **Remember:** the first three (Confidentiality, Integrity, Availability) are called the **CIA triad**, the core of information security.
