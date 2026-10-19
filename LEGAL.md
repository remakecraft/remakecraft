# Responsible use

Remakecraft rewrites an app's behaviour from scratch, without reading its code. That is a lawful thing to do in most places, for most apps, when you do it the way the default mode does. This page says what the tool is for, what it is not for, what each mode means, and how rights holders reach the author.

**This is not legal advice.** The law differs by country and by app. If a run matters commercially, ask a lawyer where you live.

## What it is for

- **Your own apps.** Rewriting software you or your company own, for a new stack or after the source was lost.
- **Abandoned software you have the right to use**, so that its behaviour survives the platform it was written for.
- **Interoperability.** Reading and writing the same file formats, protocols and shortcuts as another program.
- **Learning.** Studying how an app behaves and how a clean-room process works.

## What it is not for

- **Getting paid software without paying for it.** A rewrite does not give you a licence to the original, and Remakecraft does not help you avoid one.
- **DRM, copy protection, licence checks, activation, anti-cheat and security software**, or anything whose purpose is to defeat them. Requests for these are refused and closed.
- **Bypassing any technical protection** to run or inspect the original: packers, encryption, licence or activation checks, logins or online access controls. In clean mode the original is only run as a lawfully licensed copy; no mode removes a protection.
- **Copying expression.** Code, icons, artwork, fonts, sounds, help text and a pixel-identical look belong to the original's owner. Remakecraft is built to keep them out; do not put them back in.
- **Passing a clone off as the original.** Use your own name, icon and colours, and say it is not affiliated.

## Your responsibility

You run Remakecraft, pick the target, supply the evidence and publish the result. You are responsible for:

- having a lawful copy of anything you observe, and complying with its licence agreement where your law lets that agreement bind you;
- trademarks, trade dress and design rights: the clone's name, icon, look and store listing;
- patents on features you rebuild;
- the licence of anything else that ends up in the clone.

In the EU and EEA, a licence term that forbids observing, studying or testing a program you are entitled to use is void (Directive 2009/24/EC art. 5(3) and 8; in Norway åndsverkloven § 41). In the US, licence terms that forbid reverse engineering are generally enforceable. Neither rule lets you copy the original's expression.

## What each mode means

| Mode | Who may look inside the original | What it is | Your position |
|---|---|---|---|
| **Clean** (default) | Nobody. The original is run as a black box; decompilers are denied by name for every role | A clean room: observers describe behaviour, builders work only from the spec and tests | The strongest position. Observing a licensed copy is permitted in the EU/EEA whatever the licence says; in the US check the licence |
| **`--with-rea`** | The observer alone, through [REA](https://github.com/morluto/rea). Builders stay walled off | A two-team clean room in the classic sense: one side reads, the other writes from the spec | Needs `--basis own\|license\|authorized`. Decompiling to build a similar program is outside the EU interoperability exception, and many licences forbid it. Only for apps you own or are authorized to inspect |
| **`--open`** | Every role, builders included | **Not a clean room**, and labelled that way in the run. Do not call its output clean-room | Needs `--basis`. The output may contain the original's expression. Only for your own code or code you are licensed to adapt |

A recorded basis is your statement, not a check. Remakecraft cannot verify it and does not make a run lawful.

## No warranty

Remakecraft is provided under the [MIT licence](LICENSE), "as is", without warranty of any kind. A documented clean-room process is evidence of independent creation, not a guarantee. The wall is a logged tripwire, not a sandbox (see the README's Limits). Neither the process, the wall log nor a parity score is a legal opinion about any clone.

## Rights holders

If you believe a repository, demo or clone published by the Remakecraft project infringes your rights, or that the tool is being promoted for a use you object to, contact the author directly. It is usually faster than a platform notice, and nothing is held against you for writing first.

- **Email:** remakecraft@proton.me
- **Or** a public issue with the `rights-holder` label, if nothing in it is confidential.

Please include who you represent, the work or mark concerned, the exact URLs or files, and what you would like changed.

| When | What |
|---|---|
| Within 3 business days | Acknowledgement |
| Within 7 days | The material is changed or removed, or you get a reasoned reply |
| Disputed | We talk first. Formal notices to GitHub follow GitHub's [DMCA](https://docs.github.com/en/site-policy/content-removal-policies/dmca-takedown-policy) and [trademark](https://docs.github.com/en/site-policy/content-removal-policies/github-trademark-policy) policies |

The project only answers for what it publishes itself: this repository, Brushling and clones listed in its gallery. Clones other people build and host are theirs; contact them, and tell us if one is listed here so we can take the listing down.

Remakecraft is not affiliated with, sponsored by or endorsed by the maker of any app it is pointed at. Names of other products are trademarks of their owners and are used only to describe behaviour.
