// The formulas of the HTML export (SR-231 AK5): KaTeX's output and the grammar that lets it into a page.
import { describe, expect, it } from "vitest";
import { ERROR_COLOUR, isFormulaHtml, setFormula } from "./formula.js";

/** One formula of each group of KaTeX's functions and environments. */
const CORPUS = String.raw`x^2_i + y'
\frac{a}{b} \dfrac{1}{2} \tfrac{3}{4} {a \over b} \binom{n}{k} \dbinom{a}{b} \cfrac{1}{1+\cfrac{1}{x}}
\sqrt{x} \sqrt[3]{y}
\begin{array}{c|c:l} a & b & c \\ \hline d & e & f \\ \hdashline g & h & i \end{array}
\begin{pmatrix}1&2\\3&4\end{pmatrix} \begin{bmatrix}a\end{bmatrix} \begin{vmatrix}b\end{vmatrix} \begin{smallmatrix}a&b\end{smallmatrix}
\begin{aligned} a &= b \\ c &= d \end{aligned} \begin{gathered} a \\ b \end{gathered} \begin{alignedat}{2} a &= b & c &= d \end{alignedat}
\begin{cases} a & x > 0 \\ b & \text{otherwise} \end{cases} \begin{rcases} a \end{rcases}
\begin{CD} A @>a>> B \\ @VbVV @AAcA \\ C @= D \end{CD}
\cancel{x} \bcancel{y} \xcancel{z} \sout{abc} \boxed{x} \phase{-78^\circ} \angl{n}
\hat{a} \tilde{b} \vec{c} \bar{d} \dot{e} \ddot{f} \breve{g} \check{h} \acute{i} \grave{j} \mathring{k}
\overline{ab} \underline{cd} \widehat{abc} \widetilde{abc} \utilde{x} \overgroup{AB} \undergroup{CD}
\overrightarrow{AB} \overleftarrow{CD} \overleftrightarrow{EF} \underrightarrow{GH} \Overrightarrow{IJ}
\overbrace{a+b}^{n} \underbrace{c+d}_{m} \overbracket{x} \underbracket{y}
\xrightarrow[below]{above} \xleftarrow{a} \xRightarrow{b} \xleftrightarrow{c} \xhookrightarrow{d} \xmapsto{e}
\color{red}{x} \textcolor{#ff0000}{y} \colorbox{blue}{z} \fcolorbox{red}{yellow}{w} {\color{#0a0} g}
\href{https://example.org}{x} \url{https://example.org} \includegraphics[height=1em]{x.png}
\htmlClass{a}{b} \htmlId{c}{d} \htmlStyle{color: red}{e} \htmlData{f=g}{h}
\left( \frac{1}{2} \right) \big( \Big[ \bigg\{ \Bigg\langle \middle| \left\lvert x \right\rvert
\int_0^1 \iint \oint \sum_{i=1}^n \prod_k \coprod \bigcup \bigoplus \lim_{x \to 0} \max \sup_{n} \limsup
\operatorname{sin} x \operatorname*{argmax}_x \mathop{f} \sum\limits_a \int\nolimits_b
\mathbb{R} \mathcal{C} \mathfrak{g} \mathscr{L} \mathrm{d} \mathit{x} \mathbf{y} \mathsf{z} \mathtt{w} \boldsymbol{\alpha} \pmb{x} \bm{y}
\text{abc} \textbf{b} \textit{c} \textrm{d} \textsf{e} \texttt{f} \textup{g} \textnormal{h} \text{äöü é ß}
\phantom{x} \hphantom{y} \vphantom{z} \smash{x} \smash[b]{y}
\rule{1em}{2em} \rule[0.5em]{3pt}{1pt} \kern1em \hspace{2em} \mkern3mu \mskip 2mu \, \: \; \! \quad \qquad \enspace
\overset{a}{b} \underset{c}{d} \stackrel{e}{f} \mathrel{=} \mathbin{+} \mathpunct{,} \mathinner{x} \mathopen{(} \mathclose{)}
\llap{a} \rlap{b} \mathllap{c} \mathrlap{d} \clap{e} \mathclap{f}
\raisebox{0.25em}{a} \vcenter{b} \hbox{c} \mathchoice{D}{T}{S}{SS}
\Huge x \huge x \LARGE x \Large x \large x \normalsize x \small x \footnotesize x \scriptsize x \tiny x
\displaystyle \sum \textstyle \sum \scriptstyle x \scriptscriptstyle y
\def\foo#1{#1^2} \foo{x} \newcommand{\bar}[1]{#1} \gdef\baz{z} \baz \let\a=b \a
\tag{1} a = b
\not= \neq \ne \notin \nleq \cancelto{0}{x}
\char"41 \copyright \dag \yen \checkmark \llbracket \rrbracket \TeX \LaTeX \KaTeX \S \P \pounds \circledR
\verb|a<b>&"| \verb+x+
a < b \& c > d "q" 'x' \{ \} \backslash \#
\alpha \beta \Gamma \varepsilon \aleph \hbar \ell \wp \Re \Im \partial \infty \nabla \emptyset
\leftarrow \Rightarrow \leftrightharpoons \rightleftharpoons \mapsto \hookrightarrow \leadsto \longrightarrow
\lbrace \rbrace \lceil \rceil \lfloor \rfloor \ulcorner \lrcorner \vert \Vert \|
\begin{equation*} a \end{equation*} \begin{matrix*}[r] a \end{matrix*} \begin{array}{|c|} \hline a \\ \hline \end{array}
\begin{subarray}{l} i \\ j \end{subarray} \substack{a \\ b} \sideset{_a^b}{_c^d}\sum
\pmod{n} \bmod \pod{m} \mod 2
\ce{H2O} \pu{1 m}
\mathrm{\TeX}^{\mathrm{sup}}_{\mathrm{sub}}`.split("\n");

describe("setFormula and isFormulaHtml (SR-231 AK5)", () => {
  it("sets every group of KaTeX's functions to HTML the grammar takes, inline and in display style", () => {
    const failed: string[] = [];
    for (const source of CORPUS) {
      for (const display of [false, true]) {
        const set = setFormula(source, display);
        if ("html" in set && !isFormulaHtml(set.html)) {
          failed.push(source);
        }
      }
    }
    expect(failed).toEqual([]);
  });

  it("draws an untrusted command as its source in the docs' grey and gives an error as its message", () => {
    const set = setFormula(String.raw`\href{javascript:alert(1)}{x}`, false);
    expect(set).toEqual({ html: expect.stringContaining(`color:${ERROR_COLOUR}`) as unknown });
    expect(JSON.stringify(set)).not.toContain("<a ");
    expect(setFormula(String.raw`\frac{1`, true)).toEqual({
      error: expect.stringContaining("KaTeX parse error") as unknown,
    });
  });

  it("gives the message of something else KaTeX throws", async () => {
    const { default: katex } = await import("katex");
    const original = katex.renderToString;
    katex.renderToString = () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- what KaTeX might throw besides its ParseError.
      throw "not an error";
    };
    try {
      expect(setFormula("x", false)).toEqual({ error: "not an error" });
    } finally {
      katex.renderToString = original;
    }
  });

  it("refuses HTML outside the grammar", () => {
    const valid = '<span class="katex"><span style="height:1em;">x</span></span>';
    expect(isFormulaHtml(valid)).toBe(true);
    for (const html of [
      "<script>alert(1)</script>",
      '<span onclick="x">a</span>',
      '<span class="a" class="b">a</span>',
      '<span style="background:url(x.png)">a</span>',
      '<span style="color:expression(alert(1))">a</span>',
      '<a href="https://example.org">x</a>',
      '<math xmlns="http://www.w3.org/1999/xhtml"></math>',
      "<span>a &lt b</span>",
      "<span>unclosed",
      "<span></mi>",
      "</span>",
      "<span/>",
      '<path d="M0 0">',
      "<span>a</span><",
      "<img src=x>",
      '<svg xmlns="http://www.w3.org/2000/svg" onload="x"></svg>',
      '<mstyle mathcolor="url(x)"></mstyle>',
      '<path d="M0 0 url(x)"/>',
    ]) {
      expect(isFormulaHtml(html), html).toBe(false);
    }
  });
});
