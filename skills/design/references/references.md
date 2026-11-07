# Finding and using references

Reviewed: 2026-11-08

References keep directions from collapsing into the same defaults. Look before offering directions whenever the look is open. A small change inside an existing design system uses that system as its reference, so skip this.

## Where to look

Start closest to the product, then widen.

1. **The product's own world.** Competitors, the category's best products, and real artifacts users already know, such as packaging, print, signage, or tools of the trade. These are the strongest references, because users judge against them.
2. **Galleries**, for layout, type, and mood.
3. **Design systems**, for conventions, states, and accessibility.
4. **Motion and game sources**, when things move or the product plays.

| Kind | Sources | Good for | Watch out |
|---|---|---|---|
| Web galleries | [Godly](https://godly.website), [Awwwards](https://www.awwwards.com), [Minimal Gallery](https://minimal.gallery), [One Page Love](https://onepagelove.com), [Land-book](https://land-book.com)¹, [Dribbble](https://dribbble.com), [Behance](https://www.behance.net)¹, [Zcool](https://www.zcool.com.cn) | Mood, layout, type pairing, first impressions | Trend pieces and concept shots are not products. Check that it would survive real content. |
| Product flows | [Nicelydone](https://nicelydone.club), [SaaSFrame](https://saasframe.io), [Mobbin](https://mobbin.com), [Page Flows](https://pageflows.com) | Real onboarding, settings, pricing, empty and error states | Some content is paid. Use what is free, and say when you could not see the rest. |
| Design systems | [Material 3](https://m3.material.io/), [Apple HIG](https://developer.apple.com/design/human-interface-guidelines), [Carbon](https://carbondesignsystem.com/), [Polaris](https://polaris.shopify.com), [Atlassian](https://atlassian.design), [Primer](https://primer.style) | Component states, density, accessibility, platform conventions | Their look belongs to their brands. Borrow the discipline, not the style. |
| Tokens and type | [Tailwind theme](https://tailwindcss.com/docs/theme), [Design Tokens group](https://www.w3.org/community/design-tokens/), [Google Fonts](https://fonts.google.com), [Type Scale](https://typescale.com), [WebAIM contrast](https://webaim.org/resources/contrastchecker/), [Refactoring UI](https://www.refactoringui.com) | Scales, naming, pairing, contrast | A scale is a tool, not a direction. |
| Motion | [Codrops](https://tympanus.net/codrops/)¹, [Osmo](https://www.osmo.supply/collection), [UI Movement](https://uimovement.com), [LottieFiles](https://lottiefiles.com) | Interaction ideas and timing | Demo code needs a license check before reuse. Motion in a demo is not proof it performs. |
| Game UI | [Game UI Database](https://www.gameuidatabase.com/)¹, [Interface In Game](https://interfaceingame.com/) | HUDs, menus, inventories, feedback under load | Screenshots are not playtests. Never copy game art. |

¹ Blocks scripted requests. Open it in a browser.

## How to use them

1. **Collect candidates.** From the list, a search, memory, or another model. A candidate is a lead, not a reference.
2. **Open each one you will use.** Look at the real page, at desktop and phone widths when you can. Drop it if it does not load, and never describe a page you have not seen.
3. **Take specific things.** Name two to four per reference: the grid, the type pairing and scale, the color proportion, the density, a motion timing, a detail. "Feels premium" is not something you can take.
4. **Spread them.** Each direction gets its own references, and at least one comes from outside the obvious category.
5. **Record them** in DESIGN.md: the link, the date you opened it, and what you took. Inspiration needs no license. Reusing code, fonts, images, or icons does, so note the license then.
6. **Never copy whole.** No logos, illustrations, photography, or a distinctive layout lifted as is.

## Keeping it current

When the Reviewed date above is more than about 90 days old, the user asks for the latest, or fewer than two sources fit the category, also search live and record what you adopt the same way.

Without a browser or network, write `references not opened`, name what you would look at and why, and continue from the project's own material.
