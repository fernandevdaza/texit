/**
 * Built-in project templates shown in the "New project" gallery.
 *
 * Every template compiles out of the box with the engine it declares and only
 * uses packages from a standard TeX Live installation. No template ships
 * binary assets: all figures are drawn with TikZ/pgfplots.
 *
 * Sources are written with String.raw so that LaTeX backslashes need no
 * escaping. Inside them, never write a dollar sign directly followed by an
 * opening brace (template interpolation) or a backtick (use \enquote{...}).
 */
import type { ProjectTemplate } from './types';

// ---------------------------------------------------------------------------
// Blank
// ---------------------------------------------------------------------------

const blankMain = String.raw`% =====================================================================
%  TexIt -- Blank document
% ---------------------------------------------------------------------
%  A minimal starting point: write between \begin{document} and
%  \end{document}, and add packages to the preamble as you need them.
%  Engine: pdfLaTeX.
% =====================================================================
\documentclass[11pt]{article}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{amsmath,amssymb}
\usepackage[margin=2.5cm]{geometry}
\usepackage{hyperref}

\title{Untitled}
\author{Your Name}
\date{\today}

\begin{document}
\maketitle

\section{Introduction}
Start writing here.

\end{document}
`;

// ---------------------------------------------------------------------------
// Article (biblatex + biber)
// ---------------------------------------------------------------------------

const articleMain = String.raw`% =====================================================================
%  TexIt -- Article
% ---------------------------------------------------------------------
%  A general-purpose article showing the essentials:
%    - title block and abstract       - amsmath equations
%    - a figure drawn with TikZ       - a booktabs table
%    - cross-references (cleveref)    - biblatex bibliography
%  References live in references.bib and are processed by biber
%  (pdfLaTeX -> biber -> pdfLaTeX); TexIt runs the whole chain for you.
%  Engine: pdfLaTeX.
% =====================================================================
\documentclass[11pt,a4paper]{article}

% ---- Fonts and encoding ----------------------------------------------
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{microtype}

% ---- Layout ------------------------------------------------------------
\usepackage[margin=2.5cm]{geometry}
\usepackage[font=small,labelfont=bf]{caption}

% ---- Mathematics -------------------------------------------------------
\usepackage{amsmath,amssymb,mathtools}

% ---- Figures and tables ------------------------------------------------
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{xcolor}
\usepackage{tikz}
\usetikzlibrary{arrows.meta,positioning}

% ---- Bibliography ------------------------------------------------------
\usepackage{csquotes}
\usepackage[backend=biber,style=authoryear,maxcitenames=2,uniquelist=false]{biblatex}
\addbibresource{references.bib}

% ---- Links and cross-references (load these last) ----------------------
\definecolor{linkblue}{HTML}{1D4ED8}
\usepackage[colorlinks=true,linkcolor=linkblue,citecolor=linkblue,urlcolor=linkblue]{hyperref}
\usepackage[capitalise,noabbrev]{cleveref}

\title{\textbf{How Ideas Spread in Small Networks}\\[0.4em]
  \large A simple model with surprising behaviour}
\author{Ada Lovelace\thanks{Department of Computing, University of Somewhere.
    \href{mailto:ada@example.org}{\texttt{ada@example.org}}}
  \and Alan Turing}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
  We study a minimal model of how an idea propagates through a small social
  network. Each person adopts the idea with a probability that grows with the
  number of neighbours who already hold it, and slowly loses interest over
  time. Despite its simplicity, the model reproduces the sharp tipping points
  observed in empirical studies of technology adoption. We derive a closed-form
  threshold for global spread, compare it with simulations on three classic
  random-graph families and discuss what it implies for seeding strategies.
\end{abstract}

\section{Introduction}
\label{sec:intro}
Why do some ideas sweep through a community while others quietly fade away?
Classic diffusion studies describe adoption as an S-shaped curve
\parencite{rogers2003}, while network science explains how the structure of
social ties shapes that curve \parencite{watts1998,barabasi1999}. In this
article we combine both perspectives in a model that is small enough to
analyse by hand.

Our contributions are threefold: we introduce the model in \cref{sec:model},
derive its spreading threshold in \cref{eq:threshold}, and compare the
prediction with simulations in \cref{sec:results}.

\section{Model}
\label{sec:model}
Consider an undirected graph $G=(V,E)$ with $n=\lvert V\rvert$ nodes. At time
$t$ each node $i$ is either \emph{unaware} ($x_i(t)=0$) or an \emph{adopter}
($x_i(t)=1$). An unaware node with $k_i(t)$ adopting neighbours becomes an
adopter with probability
\begin{equation}
  p_i(t) = 1 - (1-\beta)^{k_i(t)}, \qquad 0 < \beta < 1,
  \label{eq:adoption}
\end{equation}
where $\beta$ measures how persuasive a single contact is. Adopters lose
interest at rate $\gamma$; this is the network analogue of the classic SIS
epidemic model \parencite{kermack1927}. Writing $\rho(t)$ for the fraction of
adopters and $\langle k\rangle$ for the mean degree, a mean-field
approximation gives
\begin{align}
  \frac{\mathrm{d}\rho}{\mathrm{d}t} &= \beta\langle k\rangle\,\rho\,(1-\rho) - \gamma\rho,
  \label{eq:meanfield}\\
  \rho^{\ast} &= 1 - \frac{\gamma}{\beta\langle k\rangle}. \notag
\end{align}
The idea therefore persists in the long run only if
\begin{equation}
  R_0 \coloneqq \frac{\beta\langle k\rangle}{\gamma} > 1 .
  \label{eq:threshold}
\end{equation}
\Cref{fig:model} illustrates the mechanism on a toy network.

\begin{figure}[t]
  \centering
  \begin{tikzpicture}[
      node distance=1.5cm,
      person/.style={circle,draw=#1!70!black,fill=#1!25,minimum size=8mm,thick},
      person/.default=gray,
      link/.style={thick,gray!60},
      flow/.style={-{Stealth[length=3mm]},very thick,orange!80!black}]
    \node[person=orange] (a) {1};
    \node[person=orange,right=of a] (b) {2};
    \node[person,above right=0.8cm and 1.3cm of b] (c) {3};
    \node[person,below right=0.8cm and 1.3cm of b] (d) {4};
    \node[person,right=3.4cm of b] (e) {5};
    \draw[link] (a) -- (b) (b) -- (c) (b) -- (d) (c) -- (d) (c) -- (e) (d) -- (e);
    \draw[flow] (b) to[bend left=30] node[above left,font=\small] {$\beta$} (c);
    \draw[flow] (b) to[bend right=30] node[below left,font=\small] {$\beta$} (d);
  \end{tikzpicture}
  \caption{Adopters (orange) try to convince each unaware neighbour (grey)
    with probability $\beta$, as in \cref{eq:adoption}.}
  \label{fig:model}
\end{figure}

\section{Results}
\label{sec:results}
We simulated the model on three random-graph families with $n=1000$ nodes,
recovery rate $\gamma=0.2$ and $\beta$ tuned so that $R_0=1.5$.
\Cref{tab:results} compares the simulated final adoption with the mean-field
prediction $\rho^\ast = 1 - 1/R_0$.

\begin{table}[t]
  \centering
  \caption{Final adoption for three network models ($R_0=1.5$, 200 runs each).}
  \label{tab:results}
  \begin{tabular}{@{}lccc@{}}
    \toprule
    Network         & $\langle k\rangle$ & $\rho^\ast$ (theory) & $\rho^\ast$ (simulated) \\
    \midrule
    Erdős--Rényi    & 6.0 & 0.333 & $0.327 \pm 0.012$ \\
    Watts--Strogatz & 6.0 & 0.333 & $0.301 \pm 0.018$ \\
    Barabási--Albert & 5.9 & 0.333 & $0.362 \pm 0.021$ \\
    \bottomrule
  \end{tabular}
\end{table}

\section{Discussion}
The mean-field threshold is accurate for homogeneous graphs but
underestimates adoption in scale-free networks, where highly connected hubs
act as super-spreaders \parencite{barabasi1999}. Clustered networks, on the
other hand, slow the spread because many contacts are redundant
\parencite{watts1998}; experiments suggest that reinforcement from several
contacts can partly compensate for this \parencite{centola2010}.

\section{Conclusion}
A two-parameter model captures the essential tipping-point behaviour of idea
diffusion. Extending the analysis to heterogeneous persuasiveness and to
time-varying networks is a natural next step.

\printbibliography

\end{document}
`;

const articleBib = String.raw`% Bibliography database for main.tex (processed by biber).
% Add entries here and cite them with \parencite{key} or \textcite{key}.

@book{rogers2003,
  author    = {Rogers, Everett M.},
  title     = {Diffusion of Innovations},
  edition   = {5},
  publisher = {Free Press},
  address   = {New York},
  year      = {2003}
}

@article{watts1998,
  author  = {Watts, Duncan J. and Strogatz, Steven H.},
  title   = {Collective Dynamics of Small-World Networks},
  journal = {Nature},
  volume  = {393},
  number  = {6684},
  pages   = {440--442},
  year    = {1998},
  doi     = {10.1038/30918}
}

@article{barabasi1999,
  author  = {Barab{\'a}si, Albert-L{\'a}szl{\'o} and Albert, R{\'e}ka},
  title   = {Emergence of Scaling in Random Networks},
  journal = {Science},
  volume  = {286},
  number  = {5439},
  pages   = {509--512},
  year    = {1999},
  doi     = {10.1126/science.286.5439.509}
}

@article{kermack1927,
  author  = {Kermack, William O. and McKendrick, Anderson G.},
  title   = {A Contribution to the Mathematical Theory of Epidemics},
  journal = {Proceedings of the Royal Society of London. Series A},
  volume  = {115},
  number  = {772},
  pages   = {700--721},
  year    = {1927},
  doi     = {10.1098/rspa.1927.0118}
}

@article{centola2010,
  author  = {Centola, Damon},
  title   = {The Spread of Behavior in an Online Social Network Experiment},
  journal = {Science},
  volume  = {329},
  number  = {5996},
  pages   = {1194--1197},
  year    = {2010},
  doi     = {10.1126/science.1185231}
}
`;

// ---------------------------------------------------------------------------
// Report (natbib + BibTeX)
// ---------------------------------------------------------------------------

const reportMain = String.raw`% =====================================================================
%  TexIt -- Technical report
% ---------------------------------------------------------------------
%  The report class with a title page, table of contents, chapters,
%  custom headings (titlesec), running headers (fancyhdr) and a natbib
%  bibliography processed by BibTeX (references.bib, style plainnat).
%  Cite with \citet{key} (textual) or \citep{key} (parenthetical).
%  Engine: pdfLaTeX + BibTeX.
% =====================================================================
\documentclass[11pt,a4paper]{report}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{microtype}
\usepackage[margin=2.5cm,headheight=14pt]{geometry}
\usepackage{amsmath}
\usepackage{booktabs}
\usepackage{xcolor}
\usepackage{tikz}
\usepackage{enumitem}
\usepackage{fancyhdr}
\usepackage{titlesec}
\usepackage[font=small,labelfont=bf]{caption}
\usepackage[round,authoryear]{natbib}

\definecolor{accent}{HTML}{0F766E}
\usepackage[colorlinks=true,linkcolor=accent,citecolor=accent,urlcolor=accent]{hyperref}
\usepackage[capitalise]{cleveref}

% ---- Headings ------------------------------------------------------------
\titleformat{\chapter}[display]
  {\normalfont\sffamily\color{accent}}
  {\large\MakeUppercase{\chaptertitlename}~\thechapter}
  {0.4em}
  {\Huge\bfseries\color{black}}
  [\vspace{0.4em}{\color{accent}\titlerule[1pt]}]
\titlespacing*{\chapter}{0pt}{0pt}{2em}
\titleformat{\section}
  {\normalfont\Large\bfseries\sffamily}{\color{accent}\thesection}{0.8em}{}
\titleformat{\subsection}
  {\normalfont\large\bfseries\sffamily}{\color{accent}\thesubsection}{0.8em}{}

% ---- Running headers -------------------------------------------------------
\pagestyle{fancy}
\fancyhf{}
\fancyhead[L]{\small\sffamily\nouppercase{\leftmark}}
\fancyhead[R]{\small\sffamily Data Centre Energy Review}
\fancyfoot[C]{\small\sffamily\thepage}
\renewcommand{\headrulewidth}{0.4pt}
\fancypagestyle{plain}{%
  \fancyhf{}%
  \fancyfoot[C]{\small\sffamily\thepage}%
  \renewcommand{\headrulewidth}{0pt}}

\begin{document}

% ---- Title page --------------------------------------------------------------
\begin{titlepage}
  \centering
  {\color{accent}\rule{\linewidth}{2pt}\par}
  \vspace{1em}
  {\sffamily\small TECHNICAL REPORT TR-2026-07\par}
  \vspace{4cm}
  {\sffamily\Huge\bfseries Reducing the Energy Footprint\\[0.3em]
    of the Campus Data Centre\par}
  \vspace{1.2em}
  {\Large Findings, options and recommendations\par}
  \vfill
  {\large Jordan Lee \quad\textbullet\quad Priya Natarajan \quad\textbullet\quad Samuel Okafor\par}
  \vspace{0.6em}
  {Facilities and Research Computing Office, Example University\par}
  \vspace{2em}
  {\today\par}
  \vspace{1.5em}
  {\color{accent}\rule{\linewidth}{2pt}\par}
\end{titlepage}

\pagenumbering{roman}
\chapter*{Executive Summary}
\addcontentsline{toc}{chapter}{Executive Summary}
The campus data centre consumed 3.2\,GWh of electricity last year, the
equivalent of roughly 900 households. Only 58\,\% of that energy reached the
servers; the rest was spent on cooling and power conversion. This report
reviews the current installation, compares it with industry practice and
evaluates three upgrade options. We recommend starting with server
consolidation, which pays for itself in about sixteen months, followed by
hot-aisle containment.

\tableofcontents
\clearpage
\pagenumbering{arabic}

% ---------------------------------------------------------------------------
\chapter{Introduction}
\label{chap:intro}

\section{Background}
Data centres account for roughly one percent of global electricity use, and
efficiency gains have so far offset most of the growth in demand for
computing \citep{masanet2020}. Our own facility, commissioned in 2009, has not
benefited from these gains: its cooling plant and power distribution reflect
the design practice of more than a decade ago.

\section{Scope and objectives}
This review was commissioned by the University Sustainability Board with
three objectives:
\begin{enumerate}[label=\textbf{O\arabic*.},leftmargin=*]
  \item quantify where the energy used by the data centre goes;
  \item benchmark the facility against comparable installations;
  \item recommend cost-effective measures to reduce consumption by at least 20\,\%.
\end{enumerate}

% ---------------------------------------------------------------------------
\chapter{Current State}
\label{chap:current}

\section{Energy consumption}
The standard indicator of data centre efficiency is the \emph{power usage
effectiveness} \citep{greengrid2012},
\begin{equation}
  \mathrm{PUE} = \frac{E_{\text{facility}}}{E_{\text{IT}}},
  \label{eq:pue}
\end{equation}
the ratio between the total energy drawn by the facility and the energy
delivered to IT equipment. A perfect facility would reach $\mathrm{PUE}=1$.
\Cref{tab:energy} and \cref{fig:energy} break down last year's consumption;
using \eqref{eq:pue} we obtain $\mathrm{PUE} = 3173/1840 \approx 1.72$.

\begin{table}[htbp]
  \centering
  \caption{Annual energy consumption by subsystem.}
  \label{tab:energy}
  \begin{tabular}{@{}lrr@{}}
    \toprule
    Subsystem                 & Energy (MWh) & Share (\%) \\
    \midrule
    IT equipment              & 1\,840 & 58.0 \\
    Cooling                   &    980 & 30.9 \\
    Power distribution losses &    245 &  7.7 \\
    Lighting and other        &    108 &  3.4 \\
    \midrule
    Total                     & 3\,173 & 100.0 \\
    \bottomrule
  \end{tabular}
\end{table}

\begin{figure}[htbp]
  \centering
  \begin{tikzpicture}[x=0.14cm,y=0.8cm]
    \foreach \share/\name [count=\i] in {58.0/IT equipment,30.9/Cooling,7.7/Power distribution,3.4/Lighting and other} {
      \fill[accent!80] (0,-\i) rectangle (\share,-\i+0.6);
      \node[anchor=east,font=\small] at (-1,-\i+0.3) {\name};
      \node[anchor=west,font=\small] at (\share+1,-\i+0.3) {\share\,\%};
    }
    \draw[gray] (0,-4.3) -- (0,0.2);
  \end{tikzpicture}
  \caption{Share of the annual energy consumption per subsystem.}
  \label{fig:energy}
\end{figure}

\section{Comparison with peers}
Hyperscale operators report PUE values close to 1.1 \citep{barroso2018},
while typical enterprise facilities of our size range between 1.5 and 2.0
\citep{shehabi2016}. Our facility therefore sits in the less efficient half
of its peer group, mainly because of its cooling overhead.

% ---------------------------------------------------------------------------
\chapter{Options}
\label{chap:options}
We evaluated three measures, assuming an electricity price of
\$0.20 per kWh. \Cref{tab:options} summarises the estimates.

\section{Option A: Hot-aisle containment}
Physically separating hot exhaust air from cold intake air lets the cooling
plant run at higher set points with the same server inlet temperatures.

\section{Option B: Free cooling}
A dry-cooler loop would use outside air instead of chillers for about seven
months a year. It offers the largest savings but also requires the largest
investment.

\section{Option C: Server consolidation}
Utilisation measurements show that 40\,\% of the physical servers run below
10\,\% load. Virtualising and decommissioning them reduces both IT and
cooling energy.

\begin{table}[htbp]
  \centering
  \caption{Estimated cost, savings and simple payback of each option.}
  \label{tab:options}
  \begin{tabular}{@{}lrrr@{}}
    \toprule
    Option                   & Cost (k\$) & Savings (MWh/yr) & Payback (yr) \\
    \midrule
    A: Hot-aisle containment & 120 & 210 & 2.9 \\
    B: Free cooling          & 450 & 520 & 4.3 \\
    C: Server consolidation  &  80 & 310 & 1.3 \\
    \bottomrule
  \end{tabular}
\end{table}

% ---------------------------------------------------------------------------
\chapter{Recommendations}
\label{chap:recommendations}
We recommend implementing the options in order of payback:
\begin{description}[style=nextline,leftmargin=2.2cm]
  \item[2026 Q4] Server consolidation (option C), which also frees rack
    space for the next phase.
  \item[2027 Q2] Hot-aisle containment (option A).
  \item[2028] Re-evaluate free cooling (option B) when the chillers reach the
    end of their service life.
\end{description}
Together, options A and C would cut annual consumption by about 520\,MWh,
or 16\,\%, and bring the PUE down to roughly 1.55.

\appendix
\chapter{Measurement Methodology}
\label{app:method}
Energy figures were taken from the building management system at 15-minute
resolution between January and December. IT load was measured at the
outputs of the uninterruptible power supplies; cooling energy was measured
at the chiller and computer-room air-handler feeds.

\bibliographystyle{plainnat}
\bibliography{references}

\end{document}
`;

const reportBib = String.raw`% Bibliography database for main.tex (BibTeX, style plainnat).

@book{barroso2018,
  author    = {Barroso, Luiz Andr{\'e} and H{\"o}lzle, Urs and Ranganathan, Parthasarathy},
  title     = {The Datacenter as a Computer: Designing Warehouse-Scale Machines},
  edition   = {3},
  publisher = {Morgan \& Claypool},
  year      = {2018}
}

@article{masanet2020,
  author  = {Masanet, Eric and Shehabi, Arman and Lei, Nuoa and Smith, Sarah and Koomey, Jonathan},
  title   = {Recalibrating Global Data Center Energy-Use Estimates},
  journal = {Science},
  volume  = {367},
  number  = {6481},
  pages   = {984--986},
  year    = {2020},
  doi     = {10.1126/science.aba3758}
}

@techreport{shehabi2016,
  author      = {Shehabi, Arman and Smith, Sarah and Sartor, Dale and Brown, Richard and Herrlin, Magnus and Koomey, Jonathan and Masanet, Eric and Horner, Nathaniel and Azevedo, In{\^e}s and Lintner, William},
  title       = {United States Data Center Energy Usage Report},
  institution = {Lawrence Berkeley National Laboratory},
  number      = {LBNL-1005775},
  year        = {2016}
}

@misc{greengrid2012,
  author       = {{The Green Grid}},
  title        = {{PUE}: A Comprehensive Examination of the Metric},
  howpublished = {White Paper 49},
  year         = {2012}
}
`;

// ---------------------------------------------------------------------------
// Thesis (multi-file, natbib + BibTeX)
// ---------------------------------------------------------------------------

const thesisMain = String.raw`% =====================================================================
%  TexIt -- Thesis / dissertation (multi-file)
% ---------------------------------------------------------------------
%  main.tex only holds the preamble and the skeleton of the document:
%    frontmatter/     title page, abstract, acknowledgements  (\input)
%    chapters/        one file per chapter and the appendix   (\include)
%    references.bib   BibTeX database (natbib, style plainnat)
%  Edit the metadata macros below; the title page uses them.
%  Tip: to compile a single chapter while writing, add for example
%       \includeonly{chapters/methods}
%  to the preamble.
%  Engine: pdfLaTeX + BibTeX.
% =====================================================================
\documentclass[11pt,a4paper,twoside,openright]{report}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{microtype}
\usepackage[a4paper,inner=3cm,outer=2.5cm,top=2.8cm,bottom=2.8cm,headheight=14pt]{geometry}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{xcolor}
\usepackage{tikz}
\usetikzlibrary{arrows.meta,positioning}
\usepackage[font=small,labelfont=bf]{caption}
\usepackage{enumitem}
\usepackage{fancyhdr}
\usepackage{titlesec}
\usepackage[round,authoryear]{natbib}
\usepackage[hidelinks]{hyperref}
\usepackage[capitalise]{cleveref}

\linespread{1.1}
\definecolor{thesisblue}{HTML}{1E3A8A}

% ---- Thesis metadata (used by frontmatter/titlepage.tex) ------------------
\newcommand{\thesistitle}{Learning to Forecast River Floods from Sparse Sensor Networks}
\newcommand{\thesisauthor}{María González}
\newcommand{\thesisdegree}{Doctor of Philosophy}
\newcommand{\thesisdepartment}{Department of Civil and Environmental Engineering}
\newcommand{\thesisuniversity}{University of Example}
\newcommand{\thesissupervisor}{Prof.~Dr.~Jane Smith}
\newcommand{\thesisdate}{September 2026}

\hypersetup{pdftitle={\thesistitle},pdfauthor={\thesisauthor}}

% ---- Chapter headings ----------------------------------------------------
\titleformat{\chapter}[display]
  {\normalfont\bfseries\color{thesisblue}}
  {\LARGE\chaptertitlename\ \thechapter}
  {0.6em}
  {\Huge}
\titlespacing*{\chapter}{0pt}{1cm}{2cm}

% ---- Running headers (chapter on even pages, section on odd pages) --------
\pagestyle{fancy}
\fancyhf{}
\fancyhead[LE]{\small\thepage\quad\nouppercase{\leftmark}}
\fancyhead[RO]{\small\nouppercase{\rightmark}\quad\thepage}
\renewcommand{\headrulewidth}{0.4pt}
\fancypagestyle{plain}{%
  \fancyhf{}%
  \fancyfoot[C]{\small\thepage}%
  \renewcommand{\headrulewidth}{0pt}}

% ---- Theorem-like environments ---------------------------------------------
\theoremstyle{definition}
\newtheorem{definition}{Definition}[chapter]

\begin{document}

% ---- Front matter -----------------------------------------------------------
\pagenumbering{roman}
\input{frontmatter/titlepage}
\input{frontmatter/abstract}
\input{frontmatter/acknowledgements}

\tableofcontents
\listoffigures
\listoftables

% ---- Main matter --------------------------------------------------------------
\cleardoublepage
\pagenumbering{arabic}
\include{chapters/introduction}
\include{chapters/background}
\include{chapters/methods}
\include{chapters/results}
\include{chapters/conclusion}

% ---- Appendices -----------------------------------------------------------------
\appendix
\include{chapters/appendix}

% ---- Bibliography -----------------------------------------------------------------
\cleardoublepage
\phantomsection
\addcontentsline{toc}{chapter}{Bibliography}
\bibliographystyle{plainnat}
\bibliography{references}

\end{document}
`;

const thesisTitlepage = String.raw`% Title page. Edit the metadata macros in main.tex rather than this file.
\begin{titlepage}
  \centering
  \vspace*{1cm}
  {\large\scshape \thesisuniversity\par}
  \vspace{0.3em}
  {\thesisdepartment\par}
  \vspace{3cm}
  {\color{thesisblue}\rule{\textwidth}{1pt}\par}
  \vspace{0.8cm}
  {\Huge\bfseries \thesistitle\par}
  \vspace{0.8cm}
  {\color{thesisblue}\rule{\textwidth}{1pt}\par}
  \vspace{2cm}
  {\Large \thesisauthor\par}
  \vfill
  A thesis submitted in fulfilment of the requirements\\
  for the degree of \emph{\thesisdegree}\par
  \vspace{1cm}
  Supervisor: \thesissupervisor\par
  \vspace{1cm}
  {\large \thesisdate\par}
\end{titlepage}
`;

const thesisAbstract = String.raw`\chapter*{Abstract}
\addcontentsline{toc}{chapter}{Abstract}

River floods are among the most damaging natural hazards, yet many
catchments are monitored by only a handful of gauges. This thesis
investigates whether machine-learning models that exploit the spatial
structure of a river network can deliver accurate flood forecasts from such
sparse observations.

We represent rain gauges and river sensors as nodes of a graph whose edges
follow the flow of water, and combine graph convolutions with recurrent
neural networks to learn how rainfall propagates downstream. On a dataset of
twelve years of observations from 48 gauges, the proposed model improves the
24-hour Nash--Sutcliffe efficiency from 0.71 to 0.80 compared with
gauge-wise recurrent models and reduces the error in predicted peak flow by a
third. We further show that the learned representations transfer to
ungauged sub-catchments with only a modest loss in skill.

\vspace{1em}
\noindent\textbf{Keywords:} flood forecasting, graph neural networks,
hydrology, sensor networks, deep learning
`;

const thesisAcknowledgements = String.raw`\chapter*{Acknowledgements}
\addcontentsline{toc}{chapter}{Acknowledgements}

I am deeply grateful to my supervisor, \thesissupervisor, for her patience,
her sharp questions and her constant encouragement. I thank the members of
the hydrology group for countless discussions over coffee, and the regional
water authority for generously sharing their data.

Finally, thank you to my family and friends, who reminded me that there is
life beyond the next deadline.
`;

const thesisIntroduction = String.raw`\chapter{Introduction}
\label{chap:intro}

\section{Motivation}
Floods affect more people worldwide than any other natural hazard. Reliable
forecasts a day ahead give communities time to protect property and, above
all, lives. Conceptual and physically based hydrological models have long
been the backbone of operational forecasting \citep{beven2012}, but they
require careful calibration and dense observations that many regions lack.

Data-driven models have recently matched or exceeded these models on
large-sample benchmarks \citep{kratzert2019}. Most of them, however, treat
each gauge in isolation and ignore the fact that water flows along a known
network of rivers.

\section{Research questions}
This thesis addresses the following questions:
\begin{enumerate}[label=\textbf{RQ\arabic*},leftmargin=*]
  \item Does explicitly modelling the river network improve flood forecasts
        from sparse sensors?
  \item How far ahead can such models forecast peak flows reliably?
  \item Can a model trained on gauged sub-catchments forecast ungauged ones?
\end{enumerate}

\section{Contributions}
We introduce a graph-based recurrent model for flood forecasting, a
benchmark dataset of twelve years of observations from 48 gauges, and an
evaluation protocol for ungauged locations.

\section{Thesis outline}
\Cref{chap:background} reviews hydrological modelling and deep learning for
time series. \Cref{chap:methods} presents the proposed model, which is
evaluated in \cref{chap:results}. \Cref{chap:conclusion} concludes and
outlines future work.
`;

const thesisBackground = String.raw`\chapter{Background}
\label{chap:background}

\section{Hydrological modelling}
Rainfall--runoff models describe how precipitation over a catchment turns
into river discharge. Forecast skill is usually measured with the
Nash--Sutcliffe efficiency \citep{nash1970},
\begin{equation}
  \mathrm{NSE} = 1 - \frac{\sum_{t} \bigl(Q_t^{\text{obs}} - Q_t^{\text{sim}}\bigr)^2}
                         {\sum_{t} \bigl(Q_t^{\text{obs}} - \overline{Q}^{\text{obs}}\bigr)^2},
  \label{eq:nse}
\end{equation}
where $Q_t$ is the discharge at time $t$. An NSE of one indicates a perfect
forecast, while zero means the forecast is no better than the mean.

\section{Recurrent neural networks}
Long short-term memory (LSTM) networks \citep{hochreiter1997} maintain a cell
state $c_t$ that is updated through gates,
\begin{align}
  f_t &= \sigma(W_f x_t + U_f h_{t-1} + b_f), \\
  c_t &= f_t \odot c_{t-1} + i_t \odot \tanh(W_c x_t + U_c h_{t-1} + b_c),
\end{align}
which lets them learn long-range dependencies such as snow melt or soil
moisture memory.

\section{Learning on graphs}
\begin{definition}[River graph]
  A \emph{river graph} is a directed acyclic graph $G=(V,E)$ whose nodes are
  measurement locations and where $(u,v)\in E$ if water flows from $u$ to
  $v$ without passing another node.
\end{definition}
Graph convolutional networks \citep{kipf2017} aggregate information from the
neighbours of each node and are a natural fit for such structures.
`;

const thesisMethods = String.raw`\chapter{Methods}
\label{chap:methods}

\section{Model architecture}
Our model processes each time step in two stages, shown in
\cref{fig:architecture}. A graph encoder first mixes information between
neighbouring gauges; a recurrent layer then models the temporal dynamics at
each node.

\begin{figure}[htbp]
  \centering
  \begin{tikzpicture}[
      node distance=0.9cm,
      block/.style={draw=thesisblue,thick,rounded corners=3pt,fill=thesisblue!8,
                    minimum height=1cm,minimum width=2.3cm,align=center,font=\small},
      arrow/.style={-{Stealth[length=2.5mm]},thick}]
    \node[block] (in) {Rain and\\river gauges};
    \node[block,right=of in] (gcn) {Graph\\encoder};
    \node[block,right=of gcn] (lstm) {Temporal\\LSTM};
    \node[block,right=of lstm] (out) {Discharge\\forecast};
    \draw[arrow] (in) -- (gcn);
    \draw[arrow] (gcn) -- (lstm);
    \draw[arrow] (lstm) -- (out);
  \end{tikzpicture}
  \caption{Overview of the proposed forecasting model.}
  \label{fig:architecture}
\end{figure}

\section{Graph encoder}
For node $i$ with upstream neighbours $\mathcal{N}(i)$, the hidden state of
layer $\ell+1$ is
\begin{equation}
  h_i^{(\ell+1)} = \sigma\Bigl( W^{(\ell)} \sum_{j\in\mathcal{N}(i)\cup\{i\}}
      \frac{h_j^{(\ell)}}{\sqrt{d_i d_j}} \Bigr),
  \label{eq:gcn}
\end{equation}
where $d_i$ is the degree of node $i$ and $\sigma$ a non-linearity.

\section{Training}
The model minimises the mean squared error of the forecast discharge,
normalised per gauge. We train on 2010--2018, validate on 2019 and 2020, and
test on 2021 and 2022.
`;

const thesisResults = String.raw`\chapter{Results}
\label{chap:results}

\section{Forecast skill}
\Cref{tab:skill} compares the proposed model with two baselines on the test
period. The graph model improves both the overall efficiency, measured with
\eqref{eq:nse}, and the accuracy of predicted flood peaks.

\begin{table}[htbp]
  \centering
  \caption{Median forecast skill over all 48 gauges in the test period.}
  \label{tab:skill}
  \begin{tabular}{@{}lccc@{}}
    \toprule
    Model             & NSE (6\,h) & NSE (24\,h) & Peak error (\%) \\
    \midrule
    Persistence       & 0.82 & 0.41 & 38.5 \\
    LSTM per gauge    & 0.90 & 0.71 & 19.2 \\
    Graph LSTM (ours) & \textbf{0.93} & \textbf{0.80} & \textbf{12.7} \\
    \bottomrule
  \end{tabular}
\end{table}

\section{Ungauged locations}
When a gauge is removed from training, the graph model still reaches a
median 24-hour NSE of 0.74 at that location, close to the 0.71 achieved by
a recurrent model trained \emph{with} the data of that gauge.
`;

const thesisConclusion = String.raw`\chapter{Conclusion}
\label{chap:conclusion}

\section{Summary}
This thesis showed that encoding the topology of the river network in a
neural forecasting model substantially improves flood forecasts from sparse
sensors (RQ1), extends the useful forecast horizon to at least 24 hours
(RQ2), and enables forecasts at ungauged locations (RQ3).

\section{Limitations and future work}
Our study covers a single temperate region. Future work should test the
approach in snow-dominated and arid catchments, incorporate numerical
weather forecasts as inputs, and quantify forecast uncertainty.
`;

const thesisAppendix = String.raw`\chapter{Supplementary Material}
\label{app:supplementary}

\section{Hyperparameters}
\Cref{tab:hyper} lists the hyperparameters selected on the validation set.

\begin{table}[htbp]
  \centering
  \caption{Hyperparameters of the graph LSTM.}
  \label{tab:hyper}
  \begin{tabular}{@{}ll@{}}
    \toprule
    Parameter            & Value \\
    \midrule
    Graph layers         & 2 \\
    Hidden size          & 128 \\
    Input window         & 72 hours \\
    Optimiser            & Adam, learning rate $10^{-3}$ \\
    Batch size           & 64 \\
    \bottomrule
  \end{tabular}
\end{table}
`;

const thesisBib = String.raw`% Bibliography database (BibTeX, style plainnat).

@article{kratzert2019,
  author  = {Kratzert, Frederik and Klotz, Daniel and Shalev, Guy and Klambauer, G{\"u}nter and Hochreiter, Sepp and Nearing, Grey},
  title   = {Towards Learning Universal, Regional, and Local Hydrological Behaviors via Machine Learning Applied to Large-Sample Datasets},
  journal = {Hydrology and Earth System Sciences},
  volume  = {23},
  number  = {12},
  pages   = {5089--5110},
  year    = {2019},
  doi     = {10.5194/hess-23-5089-2019}
}

@article{hochreiter1997,
  author  = {Hochreiter, Sepp and Schmidhuber, J{\"u}rgen},
  title   = {Long Short-Term Memory},
  journal = {Neural Computation},
  volume  = {9},
  number  = {8},
  pages   = {1735--1780},
  year    = {1997},
  doi     = {10.1162/neco.1997.9.8.1735}
}

@inproceedings{kipf2017,
  author    = {Kipf, Thomas N. and Welling, Max},
  title     = {Semi-Supervised Classification with Graph Convolutional Networks},
  booktitle = {International Conference on Learning Representations (ICLR)},
  year      = {2017}
}

@book{beven2012,
  author    = {Beven, Keith J.},
  title     = {Rainfall-Runoff Modelling: The Primer},
  edition   = {2},
  publisher = {Wiley-Blackwell},
  address   = {Chichester},
  year      = {2012}
}

@article{nash1970,
  author  = {Nash, J. Eamonn and Sutcliffe, John V.},
  title   = {River Flow Forecasting through Conceptual Models Part {I}: A Discussion of Principles},
  journal = {Journal of Hydrology},
  volume  = {10},
  number  = {3},
  pages   = {282--290},
  year    = {1970},
  doi     = {10.1016/0022-1694(70)90255-6}
}
`;

// ---------------------------------------------------------------------------
// Beamer presentation
// ---------------------------------------------------------------------------

const beamerMain = String.raw`% =====================================================================
%  TexIt -- Beamer presentation (clean, metropolis-inspired look)
% ---------------------------------------------------------------------
%  Built only from beamer's own templates and colours: no extra theme
%  packages or fonts are required. Change the palette below to re-brand
%  the whole deck. Every frame is a slide; overlays such as \pause,
%  \only<2>{...} or \item<3-> reveal content step by step.
%  Engine: pdfLaTeX.
% =====================================================================
\documentclass[aspectratio=169,11pt]{beamer}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{booktabs}
\usepackage{tikz}
\usetikzlibrary{arrows.meta,positioning}

% ---- Palette ------------------------------------------------------------
\definecolor{brandDark}{HTML}{23373B}
\definecolor{brandAccent}{HTML}{EB811B}
\definecolor{brandLight}{HTML}{FAFAFA}
\definecolor{brandGreen}{HTML}{14B03D}

% ---- Colours --------------------------------------------------------------
\setbeamercolor{normal text}{fg=brandDark,bg=brandLight}
\setbeamercolor{background canvas}{bg=brandLight}
\setbeamercolor{structure}{fg=brandDark}
\setbeamercolor{alerted text}{fg=brandAccent}
\setbeamercolor{example text}{fg=brandGreen!80!black}
\setbeamercolor{frametitle}{fg=brandLight,bg=brandDark}
\setbeamercolor{title}{fg=brandDark}
\setbeamercolor{subtitle}{fg=brandDark!75}
\setbeamercolor{item}{fg=brandAccent}
\setbeamercolor{block title}{fg=brandDark,bg=brandDark!12}
\setbeamercolor{block body}{fg=brandDark,bg=brandDark!4}
\setbeamercolor{block title alerted}{fg=brandLight,bg=brandAccent}
\setbeamercolor{block body alerted}{fg=brandDark,bg=brandAccent!8}
\setbeamercolor{block title example}{fg=brandLight,bg=brandGreen!80!black}
\setbeamercolor{block body example}{fg=brandDark,bg=brandGreen!7}
\setbeamercolor{page number in head/foot}{fg=brandDark!60}

% ---- Fonts and inner elements -------------------------------------------------
\setbeamerfont{title}{size=\LARGE,series=\bfseries}
\setbeamerfont{subtitle}{size=\large}
\setbeamerfont{frametitle}{size=\large,series=\bfseries}
\setbeamerfont{section title}{size=\Large,series=\bfseries}
\setbeamerfont{block title}{series=\bfseries}
\setbeamerfont{page number in head/foot}{size=\scriptsize}
\setbeamertemplate{navigation symbols}{}
\setbeamertemplate{itemize items}[triangle]
\setbeamertemplate{enumerate items}[default]
\setbeamertemplate{blocks}[rounded][shadow=false]
\setbeamertemplate{section in toc}[sections numbered]

% ---- Progress bar: \progressbar[width] ------------------------------------------
\makeatletter
\newlength{\texit@progress}
\newcommand{\progressbar}[1][\paperwidth]{%
  \pgfmathsetlength{\texit@progress}{#1*min(1,\insertframenumber/\inserttotalframenumber)}%
  \begin{tikzpicture}
    \fill[brandAccent!25] (0,0) rectangle (#1,0.4ex);
    \fill[brandAccent] (0,0) rectangle (\texit@progress,0.4ex);
  \end{tikzpicture}%
}
\makeatother

% ---- Templates ---------------------------------------------------------------------
\setbeamertemplate{frametitle}{%
  \nointerlineskip
  \begin{beamercolorbox}[wd=\paperwidth,ht=3.2ex,dp=1.6ex,leftskip=1.2em,rightskip=1.2em]{frametitle}%
    \usebeamerfont{frametitle}\insertframetitle
  \end{beamercolorbox}%
  \nointerlineskip
  \hbox to \paperwidth{\progressbar\hss}%
}

\setbeamertemplate{title page}{%
  \vfill
  {\usebeamerfont{title}\usebeamercolor[fg]{title}\inserttitle\par}
  \vspace{0.4em}
  {\usebeamerfont{subtitle}\usebeamercolor[fg]{subtitle}\insertsubtitle\par}
  \vspace{0.8em}
  \progressbar[\textwidth]\par
  \vspace{0.8em}
  {\usebeamerfont{author}\insertauthor\par}
  \vspace{0.3em}
  {\usebeamerfont{institute}\color{brandDark!70}\insertinstitute\par}
  \vspace{0.3em}
  {\usebeamerfont{date}\color{brandDark!70}\insertdate\par}
  \vfill
}

\setbeamertemplate{footline}{%
  \hfill
  \usebeamercolor[fg]{page number in head/foot}%
  \usebeamerfont{page number in head/foot}%
  \insertframenumber\,/\,\inserttotalframenumber\kern1.2em\vskip8pt
}

\AtBeginSection[]{%
  \begin{frame}[plain,noframenumbering]
    \vfill
    {\usebeamerfont{section title}\usebeamercolor[fg]{structure}\insertsectionhead\par}
    \vspace{0.6em}
    \progressbar[\textwidth]
    \vfill
  \end{frame}
}

% Overlay-aware TikZ styles: \node[onslide=<2>{fill=red}] ...
\tikzset{onslide/.code args={<#1>#2}{\only<#1>{\pgfkeysalso{#2}}}}

% ---- Title information ---------------------------------------------------------------
\title{Writing Beautiful Papers Together}
\subtitle{A short tour of what beamer can do}
\author{Grace Hopper}
\institute{TexIt Workshop, Example University}
\date{\today}

\begin{document}

\begin{frame}[plain]
  \titlepage
\end{frame}

\begin{frame}{Outline}
  \tableofcontents
\end{frame}

% =====================================================================
\section{Getting started}

\begin{frame}{Why make slides in \LaTeX?}
  \begin{itemize}
    \item<1-> Consistent typography and \alert{beautiful mathematics}
    \item<2-> Plain-text sources that work with version control
    \item<3-> Reuse equations, figures and references from your paper
  \end{itemize}
  \vspace{1.5em}
  \uncover<4->{%
    \begin{center}
      \Large $\displaystyle \int_{-\infty}^{\infty} e^{-x^2}\,\mathrm{d}x = \sqrt{\pi}$
    \end{center}}
\end{frame}

\begin{frame}{Blocks highlight key messages}
  \begin{block}{Definition}
    A \emph{prime number} is a natural number greater than one whose only
    divisors are one and itself.
  \end{block}
  \begin{alertblock}{Watch out}
    One is \alert{not} a prime number.
  \end{alertblock}
  \begin{exampleblock}{Example}
    $2, 3, 5, 7, 11, 13, 17, \dots$
  \end{exampleblock}
\end{frame}

% =====================================================================
\section{Figures and layout}

\begin{frame}{Columns and TikZ diagrams}
  \begin{columns}[T,onlytextwidth]
    \begin{column}{0.44\textwidth}
      Split a slide into columns to place text next to a figure.
      \medskip
      \begin{enumerate}
        \item<alert@1> Write the source
        \item<alert@2> Compile it
        \item<alert@3> Review the PDF
      \end{enumerate}
      \medskip
      Each step lights up on its own overlay.
    \end{column}
    \begin{column}{0.52\textwidth}
      \centering
      \begin{tikzpicture}[
          node distance=0.9cm,
          stage/.style={rounded corners=3pt,draw=brandDark,thick,fill=brandDark!6,
                       minimum width=3cm,minimum height=8mm,font=\small},
          active/.style={fill=brandAccent,draw=brandAccent,text=white},
          arrow/.style={-{Stealth[length=2.5mm]},thick,brandDark!70}]
        \node[stage,onslide=<1>{active}] (src) {Source file};
        \node[stage,below=of src,onslide=<2>{active}] (tex) {\LaTeX{} engine};
        \node[stage,below=of tex,onslide=<3>{active}] (pdf) {PDF preview};
        \draw[arrow] (src) -- (tex);
        \draw[arrow] (tex) -- (pdf);
        \draw[arrow] (pdf.east) -- ++(0.7,0) |- node[pos=0.25,right,font=\scriptsize] {edit} (src.east);
      \end{tikzpicture}
    \end{column}
  \end{columns}
\end{frame}

\begin{frame}{Building up a chart}
  \centering
  \begin{tikzpicture}[x=1.6cm,y=0.5cm]
    \draw[brandDark!40] (0.3,0) -- (4.7,0);
    \foreach \h/\lab [count=\i] in {3/Q1,5/Q2,4/Q3,7/Q4} {
      \visible<\i->{%
        \fill[brandAccent!85] (\i-0.3,0) rectangle (\i+0.3,\h);
        \node[above,font=\small] at (\i,\h) {\h};
      }
      \node[below,font=\small] at (\i,0) {\lab};
    }
  \end{tikzpicture}

  \medskip
  \only<4>{\alert{Q4 was our best quarter so far!}}
\end{frame}

% =====================================================================
\section{Results}

\begin{frame}{Equations and tables}
  \begin{columns}[c,onlytextwidth]
    \begin{column}{0.48\textwidth}
      The normal distribution:
      \[
        f(x) = \frac{1}{\sigma\sqrt{2\pi}}
               \exp\!\left(-\frac{(x-\mu)^2}{2\sigma^2}\right)
      \]
      Inline mathematics such as $e^{i\pi}+1=0$ works too.
    \end{column}
    \begin{column}{0.48\textwidth}
      \centering
      \begin{tabular}{@{}lrr@{}}
        \toprule
        Method   & Time (s)    & Accuracy \\
        \midrule
        Baseline & 12.4        & 81.2\,\% \\
        Ours     & \alert{3.1} & \alert{88.7\,\%} \\
        \bottomrule
      \end{tabular}
    \end{column}
  \end{columns}
\end{frame}

% =====================================================================
\section{Conclusion}

\begin{frame}{Summary}
  \begin{itemize}[<+->]
    \item Beamer gives you a complete slide toolkit in plain text.
    \item This look uses only built-in templates and a few colours.
    \item Edit the palette in the preamble to match your brand.
  \end{itemize}
\end{frame}

{
\setbeamercolor{background canvas}{bg=brandDark}
\begin{frame}[plain,noframenumbering]
  \centering
  {\color{brandLight}\Huge\bfseries Questions?\par}
  \vspace{1em}
  {\color{brandAccent}\large grace.hopper@example.org\par}
\end{frame}
}

\end{document}
`;

// ---------------------------------------------------------------------------
// Poster (tikzposter)
// ---------------------------------------------------------------------------

const posterMain = String.raw`% =====================================================================
%  TexIt -- Academic poster (tikzposter, A0 portrait)
% ---------------------------------------------------------------------
%  Content is organised in \block{Title}{Body} boxes placed inside
%    \begin{columns} \column{0.5} ... \column{0.5} ... \end{columns}
%  Colours come from the TexIt colour style defined below. For a
%  landscape poster, replace "portrait" with "landscape".
%  Engine: pdfLaTeX.
% =====================================================================
\documentclass[25pt,a0paper,portrait,margin=0mm,innermargin=15mm,
  blockverticalspace=15mm,colspace=15mm,subcolspace=8mm]{tikzposter}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{amsmath,amssymb}
\usepackage{booktabs}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\usetikzlibrary{arrows.meta,positioning}

% ---- Colour style ---------------------------------------------------------
\definecolorstyle{TexIt}{
  \definecolor{colorOne}{HTML}{0F172A}
  \definecolor{colorTwo}{HTML}{0284C7}
  \definecolor{colorThree}{HTML}{F59E0B}
}{
  % Background
  \colorlet{backgroundcolor}{colorOne!3}
  \colorlet{framecolor}{colorOne}
  % Title
  \colorlet{titlefgcolor}{white}
  \colorlet{titlebgcolor}{colorOne}
  % Blocks
  \colorlet{blocktitlebgcolor}{colorTwo}
  \colorlet{blocktitlefgcolor}{white}
  \colorlet{blockbodybgcolor}{white}
  \colorlet{blockbodyfgcolor}{colorOne}
  % Inner blocks
  \colorlet{innerblocktitlebgcolor}{colorThree}
  \colorlet{innerblocktitlefgcolor}{white}
  \colorlet{innerblockbodybgcolor}{colorThree!12}
  \colorlet{innerblockbodyfgcolor}{colorOne}
  % Notes
  \colorlet{notefgcolor}{colorOne}
  \colorlet{notebgcolor}{colorThree!25}
  \colorlet{noteframecolor}{colorThree}
}
\usetheme{Default}
\usecolorstyle{TexIt}

% ---- Title -------------------------------------------------------------------
% tikzposter sets the title in a single line; the \parbox lets it wrap.
\title{\parbox{\linewidth}{\centering Low-Cost Sensors Reveal Street-Level Air Pollution Hotspots}}
\author{Lena Fischer\textsuperscript{1}, Kwame Mensah\textsuperscript{2}, Sofia Rossi\textsuperscript{1}}
\institute{\textsuperscript{1}Institute for Environmental Data Science, Example University
  \qquad \textsuperscript{2}City Environmental Agency}

\begin{document}
\maketitle

\begin{columns}
  % ---------------------------------------------------------------------------
  \column{0.5}

  \block{Motivation}{
    Fine particulate matter (PM$_{2.5}$) is the environmental risk factor
    with the largest health burden worldwide. Reference monitoring stations
    are accurate but expensive, so most cities operate only a handful of
    them, and pollution at street level remains largely invisible.

    \vspace{1em}
    \innerblock{Research question}{
      Can a dense network of 120 low-cost sensors match a reference station
      to within 15\,\% after calibration, and reveal hotspots that the
      official network misses?
    }
  }

  \block{Method}{
    \begin{tikzfigure}[Processing pipeline from raw readings to hotspot maps.]
      \begin{tikzpicture}[
          node distance=2.2cm,
          stage/.style={draw=colorOne,very thick,rounded corners=8pt,fill=colorTwo!10,
                        minimum width=8cm,minimum height=3.2cm,align=center},
          flow/.style={-{Stealth[length=8mm]},line width=3pt,colorTwo}]
        \node[stage] (raw) {Raw sensor\\readings};
        \node[stage,right=of raw] (cal) {Calibration\\model};
        \node[stage,right=of cal] (map) {Hotspot\\map};
        \draw[flow] (raw) -- (cal);
        \draw[flow] (cal) -- (map);
      \end{tikzpicture}
    \end{tikzfigure}

    \vspace{1em}
    \begin{itemize}
      \item 120 optical particle counters mounted on lamp posts for 12 months
      \item Two sensors co-located with the reference station for calibration
      \item Humidity and temperature correction with the linear model
    \end{itemize}
    \[
      \hat{c} = \alpha + \beta_1\, c_{\text{raw}} + \beta_2\, \mathrm{RH} + \beta_3\, T
    \]
  }

  % ---------------------------------------------------------------------------
  \column{0.5}

  \block{Results}{
    \begin{tikzfigure}[Calibrated sensor readings closely follow the reference station.]
      \begin{tikzpicture}
        \begin{axis}[
            width=32cm, height=19cm,
            xlabel={Reference PM$_{2.5}$ ($\mu$g/m$^3$)},
            ylabel={Sensor PM$_{2.5}$ ($\mu$g/m$^3$)},
            xmin=0, xmax=60, ymin=0, ymax=60,
            grid=major, grid style={gray!25},
            legend pos=north west, legend cell align=left]
          \addplot[only marks, mark=*, mark size=6pt, colorTwo, fill opacity=0.7]
            coordinates {(4,5.2) (7,6.1) (9,10.4) (12,11.3) (15,16.2) (18,17.1)
                         (21,22.8) (24,23.5) (28,26.9) (31,32.6) (35,34.1)
                         (38,39.7) (42,40.2) (46,47.9) (51,49.8) (55,56.4)};
          \addlegendentry{Hourly means}
          \addplot[colorThree, line width=4pt, domain=0:60, samples=2] {0.99*x + 0.6};
          \addlegendentry{Linear fit}
          \addplot[gray, dashed, line width=2pt, domain=0:60, samples=2] {x};
          \addlegendentry{$y = x$}
        \end{axis}
      \end{tikzpicture}
    \end{tikzfigure}

    \vspace{1em}
    \centering
    \begin{tabular}{@{}lcc@{}}
      \toprule
      Metric               & Raw   & Calibrated \\
      \midrule
      $R^2$                & 0.71  & 0.94 \\
      Mean abs.\ error     & 9.8   & 2.1 \\
      Relative error (\%)  & 41    & 9 \\
      \bottomrule
    \end{tabular}
  }

  \block{Conclusions}{
    \begin{itemize}
      \item Calibrated low-cost sensors agree with the reference to within 9\,\%.
      \item Seven hotspots near bus depots and junctions were not covered by
            the official network.
      \item A network of 120 sensors costs less than one reference station.
    \end{itemize}
  }

  \block{References}{
    \small
    [1] World Health Organization. \emph{WHO Global Air Quality Guidelines}.
    Geneva, 2021.

    \smallskip
    [2] Karagulian, F.\ et al. Review of the performance of low-cost sensors for
    air quality monitoring. \emph{Atmosphere} 10(9), 506, 2019.
  }

\end{columns}

\end{document}
`;

// ---------------------------------------------------------------------------
// CV (pdfLaTeX)
// ---------------------------------------------------------------------------

const cvMain = String.raw`% =====================================================================
%  TexIt -- Modern CV / resume (pdfLaTeX)
% ---------------------------------------------------------------------
%  A single file with no icon fonts: the small contact icons and the
%  skill dots are drawn with TikZ. Edit the header, then add entries:
%    \cventry{dates}{role}{organisation}{location}{details}
%  and bullet points inside the details with \cvpoint{...}.
%  Engine: pdfLaTeX.
% =====================================================================
\documentclass[10pt,a4paper]{article}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\renewcommand*{\familydefault}{\sfdefault}
\usepackage{microtype}
\usepackage[a4paper,hmargin=1.7cm,vmargin=1.5cm]{geometry}
\usepackage{xcolor}
\usepackage{tikz}
\usepackage{tabularx}
\usepackage{titlesec}
\usepackage[hidelinks]{hyperref}

% ---- Colours ---------------------------------------------------------------
\definecolor{accent}{HTML}{0D9488}
\definecolor{ink}{HTML}{1F2937}
\definecolor{muted}{HTML}{6B7280}

\pagestyle{empty}
\setlength{\parindent}{0pt}

% ---- Section headings --------------------------------------------------------
\titleformat{\section}{\large\bfseries\color{accent}}{}{0pt}{\MakeUppercase}
  [\vspace{-0.5ex}{\color{accent!30}\titlerule[0.8pt]}]
\titlespacing*{\section}{0pt}{1.2em}{0.7em}

% ---- Icons drawn with TikZ -----------------------------------------------------
\tikzset{icon/.style={baseline=-0.55ex,x=1ex,y=1ex,line width=0.55pt,accent}}
\newcommand{\iconmail}{\tikz[icon]{%
  \draw[rounded corners=0.1ex] (-0.8,-0.55) rectangle (0.8,0.55);
  \draw (-0.8,0.5) -- (0,-0.1) -- (0.8,0.5);}}
\newcommand{\iconphone}{\tikz[icon]{%
  \draw[rounded corners=0.2ex] (-0.45,-0.85) rectangle (0.45,0.85);
  \fill (0,-0.55) circle (0.12);}}
\newcommand{\iconpin}{\tikz[icon]{%
  \fill (0,-0.9) -- (-0.52,0.1) arc[start angle=180,end angle=0,radius=0.52] -- cycle;
  \fill[white] (0,0.12) circle (0.2);}}
\newcommand{\iconweb}{\tikz[icon]{%
  \draw (0,0) circle (0.8);
  \draw (-0.8,0) -- (0.8,0);
  \draw (0,0) ellipse (0.35 and 0.8);}}
\newcommand{\iconcode}{\tikz[icon]{%
  \draw[line cap=round,line join=round] (-0.3,0.55) -- (-0.85,0) -- (-0.3,-0.55);
  \draw[line cap=round,line join=round] (0.3,0.55) -- (0.85,0) -- (0.3,-0.55);
  \draw[line cap=round] (0.15,0.7) -- (-0.15,-0.7);}}

% ---- Entries -----------------------------------------------------------------------
\newlength{\datecol}
\setlength{\datecol}{2.4cm}
% \cventry{dates}{role}{organisation}{location}{details}
\newcommand{\cventry}[5]{%
  \begin{tabularx}{\linewidth}{@{}p{\datecol}X@{}}
    {\small\color{muted}#1} & \textbf{#2}\hfill{\small\color{muted}#4}\\
                            & {\color{accent}#3}\\[2pt]
                            & \small #5
  \end{tabularx}\par\medskip}
\newcommand{\cvpoint}[1]{\par\noindent\hangindent=1em\hangafter=1
  \makebox[1em][l]{\tikz[baseline=-0.55ex]\fill[accent] (0,0) circle (0.2em);}#1}
% Skill level from 1 to 5
\newcommand{\skilldots}[1]{\tikz[baseline=-0.55ex]{%
  \foreach \i in {1,...,5} \fill[accent!20] (\i*0.8em,0) circle (0.28em);
  \foreach \i in {1,...,#1} \fill[accent] (\i*0.8em,0) circle (0.28em);}}

\begin{document}
\color{ink}

% ---- Header ----------------------------------------------------------------------------
\begin{minipage}[b]{0.6\textwidth}
  {\fontsize{28}{32}\selectfont\bfseries Alex Rivera\par}
  \vspace{6pt}
  {\Large\color{accent}Senior Software Engineer\par}
\end{minipage}%
\hfill
\begin{minipage}[b]{0.38\textwidth}
  \raggedleft\small
  \href{mailto:alex.rivera@example.com}{alex.rivera@example.com}\hspace{0.6em}\iconmail\\[3pt]
  +1 (555) 012-3456\hspace{0.6em}\iconphone\\[3pt]
  Portland, OR\hspace{0.6em}\iconpin\\[3pt]
  \href{https://example.com}{example.com/alex}\hspace{0.6em}\iconweb\\[3pt]
  \href{https://github.com}{github.com/alexrivera}\hspace{0.6em}\iconcode
\end{minipage}

% ---------------------------------------------------------------------------------------
\section{Profile}
Software engineer with eight years of experience building data-intensive web
products. I enjoy turning messy requirements into reliable systems, mentoring
engineers and making complex data easy to understand.

\section{Experience}
\cventry{2022 -- now}{Senior Software Engineer}{Lumen Health}{Portland, OR}{%
  \cvpoint{Lead a team of five building a real-time analytics platform that processes two billion events per day.}
  \cvpoint{Cut dashboard load times by 70\,\% by redesigning the query layer around pre-aggregated tables.}
  \cvpoint{Introduced design reviews and an on-call handbook now used by four other teams.}}
\cventry{2019 -- 2022}{Software Engineer}{Cartograph Labs}{Seattle, WA}{%
  \cvpoint{Built interactive map visualisations used by more than 300 city planning departments.}
  \cvpoint{Migrated a monolith to typed services in Go and TypeScript without downtime.}}
\cventry{2017 -- 2019}{Junior Developer}{Brightline Studio}{Remote}{%
  \cvpoint{Shipped web applications in React and Django for clients in education and retail.}}

\section{Education}
\cventry{2013 -- 2017}{B.Sc.\ in Computer Science}{University of Washington}{Seattle, WA}{%
  Minor in Statistics. Thesis: \emph{Fast approximate joins for streaming data}.}

\section{Skills}
\begin{tabularx}{\linewidth}{@{}Xr@{\hspace{2.5em}}Xr@{}}
  Python and data tooling  & \skilldots{5} & TypeScript and React & \skilldots{4} \\[3pt]
  Go                       & \skilldots{4} & SQL and PostgreSQL   & \skilldots{4} \\[3pt]
  Cloud (AWS, Terraform)   & \skilldots{3} & Data visualisation   & \skilldots{5} \\
\end{tabularx}

\section{Projects}
\cventry{2024}{TidyGraph}{Open-source graph analytics library}{1.2k stars}{%
  A small, well-documented library for analysing networks in Python.}
\cventry{2021}{Transit Pulse}{Hackathon winner}{Seattle, WA}{%
  Live visualisation of bus delays built in one weekend with open city data.}

\section{Languages and interests}
\textbf{Languages:} English (native), Spanish (professional), Portuguese (basic)\\[3pt]
\textbf{Interests:} trail running, analogue photography, community radio

\end{document}
`;

// ---------------------------------------------------------------------------
// CV (XeLaTeX + fontspec)
// ---------------------------------------------------------------------------

const cvXelatexMain = String.raw`% !TEX program = xelatex
% =====================================================================
%  TexIt -- Resume with a sidebar (XeLaTeX + fontspec)
% ---------------------------------------------------------------------
%  Compile with XeLaTeX. Fonts are loaded by FILE NAME (TeX Gyre Heros
%  ships with TeX Live), so no system fonts or fontconfig are needed.
%  To use another font, upload its .otf files to the project and change
%  \setmainfont below. The coloured sidebar is painted on every page by
%  the shipout/background hook; edit its content in the left minipage.
% =====================================================================
\documentclass[10pt,a4paper]{article}

\usepackage{fontspec}
\setmainfont{texgyreheros}[
  Extension      = .otf,
  UprightFont    = *-regular,
  BoldFont       = *-bold,
  ItalicFont     = *-italic,
  BoldItalicFont = *-bolditalic]

\usepackage[a4paper,left=0.9cm,right=1.3cm,top=1.3cm,bottom=1.2cm]{geometry}
\usepackage{xcolor}
\usepackage{tikz}
\usepackage[hidelinks]{hyperref}

% ---- Colours ---------------------------------------------------------------
\definecolor{sidebar}{HTML}{1E293B}
\definecolor{accent}{HTML}{38BDF8}
\definecolor{accentdark}{HTML}{0369A1}
\definecolor{ink}{HTML}{1F2937}
\definecolor{muted}{HTML}{64748B}

\pagestyle{empty}
\setlength{\parindent}{0pt}

% ---- Sidebar background ------------------------------------------------------
\newlength{\sidebarwidth}
\setlength{\sidebarwidth}{6.6cm}
\newlength{\sidebarinner}
\setlength{\sidebarinner}{5cm}
\AddToHook{shipout/background}{%
  \put(0,0){\makebox[0pt][l]{\raisebox{-\paperheight}[0pt][0pt]{%
    \textcolor{sidebar}{\rule{\sidebarwidth}{\paperheight}}}}}}

% ---- Helpers -------------------------------------------------------------------
\newcommand{\sidesection}[1]{%
  \vspace{1.4em}%
  {\color{accent}\bfseries\small\addfontfeatures{LetterSpace=8}\MakeUppercase{#1}\par}%
  \vspace{0.35em}%
  {\color{white!20!sidebar}\rule{\linewidth}{0.6pt}\par}%
  \vspace{0.6em}}
\newcommand{\mainsection}[1]{%
  \vspace{1.3em}%
  {\large\bfseries\addfontfeatures{LetterSpace=6}\MakeUppercase{#1}\par}%
  \vspace{0.3em}%
  {\color{accent}\rule{1.2cm}{2pt}\par}%
  \vspace{0.7em}}
\tikzset{icon/.style={baseline=-0.55ex,x=1ex,y=1ex,line width=0.55pt,accent}}
\newcommand{\iconmail}{\tikz[icon]{%
  \draw[rounded corners=0.1ex] (-0.8,-0.55) rectangle (0.8,0.55);
  \draw (-0.8,0.5) -- (0,-0.1) -- (0.8,0.5);}}
\newcommand{\iconphone}{\tikz[icon]{%
  \draw[rounded corners=0.2ex] (-0.45,-0.85) rectangle (0.45,0.85);
  \fill (0,-0.55) circle (0.12);}}
\newcommand{\iconpin}{\tikz[icon]{%
  \fill (0,-0.9) -- (-0.52,0.1) arc[start angle=180,end angle=0,radius=0.52] -- cycle;
  \fill[sidebar] (0,0.12) circle (0.2);}}
\newcommand{\iconweb}{\tikz[icon]{%
  \draw (0,0) circle (0.8);
  \draw (-0.8,0) -- (0.8,0);
  \draw (0,0) ellipse (0.35 and 0.8);}}
\newcommand{\sideitem}[2]{\makebox[1.6em][l]{#1}#2\par\vspace{4pt}}
% \skillbar{name}{level between 0 and 1}
\newcommand{\skillbar}[2]{%
  #1\par\vspace{3pt}%
  \tikz{\fill[white!18!sidebar] (0,0) rectangle (\linewidth,3pt);
        \fill[accent] (0,0) rectangle (#2\linewidth,3pt);}\par\vspace{6pt}}
% \entry{role}{organisation}{dates}{details}
\newcommand{\entry}[4]{%
  {\bfseries #1}\hfill{\small\color{muted}#3}\par
  {\color{accentdark}#2}\par\vspace{3pt}
  {\small #4}\par\vspace{0.9em}}
\newcommand{\point}[1]{\par\hangindent=1em\hangafter=1\noindent
  \makebox[1em][l]{\tikz[baseline=-0.55ex]\fill[accent] (0,0) circle (0.18em);}#1}

\begin{document}
\noindent
% ===================== Sidebar =====================
\begin{minipage}[t]{\sidebarinner}
  \vspace{0pt}
  \color{white}
  \centering
  \begin{tikzpicture}
    \fill[accent] (0,0) circle (1.25cm);
    \node[text=sidebar,font=\fontsize{28}{28}\selectfont\bfseries] at (0,0) {DN};
  \end{tikzpicture}
  \par\raggedright

  \sidesection{Contact}
  \small
  \sideitem{\iconmail}{daniela.novak@example.com}
  \sideitem{\iconphone}{+44 20 7946 0958}
  \sideitem{\iconpin}{London, United Kingdom}
  \sideitem{\iconweb}{example.com/daniela}

  \sidesection{Skills}
  \skillbar{Figma and prototyping}{0.95}
  \skillbar{HTML and CSS}{0.9}
  \skillbar{TypeScript and React}{0.8}
  \skillbar{Accessibility (WCAG)}{0.85}
  \skillbar{User research}{0.75}

  \sidesection{Languages}
  Czech \hfill {\color{accent}native}\par\vspace{3pt}
  English \hfill {\color{accent}fluent}\par\vspace{3pt}
  German \hfill {\color{accent}intermediate}\par

  \sidesection{Interests}
  Typography, ceramics, long-distance cycling and community design workshops.
\end{minipage}%
\hspace{1.6cm}%
% ===================== Main column =====================
\begin{minipage}[t]{\dimexpr\textwidth-\sidebarinner-1.6cm\relax}
  \vspace{0pt}
  \color{ink}
  {\fontsize{30}{34}\selectfont\bfseries Daniela Novák\par}
  \vspace{6pt}
  {\Large\color{accentdark}Product Designer \& Front-end Developer\par}

  \mainsection{Profile}
  Designer and developer with nine years of experience shipping accessible,
  data-rich products. I bridge research, interaction design and production
  code, and I love building design systems that teams actually enjoy using.

  \mainsection{Experience}
  \entry{Lead Product Designer}{Fieldnote, London}{2023 -- present}{%
    \point{Lead a team of four designers across web and mobile apps used by 2 million people.}
    \point{Created the Fieldnote design system: 60 components, fully documented and accessible.}
    \point{Raised task completion in onboarding from 61\,\% to 84\,\% through iterative testing.}}
  \entry{Product Designer}{Brightwave Bank, London}{2020 -- 2023}{%
    \point{Redesigned the savings experience, increasing monthly active savers by 35\,\%.}
    \point{Ran fortnightly usability sessions and shared insights with product teams.}}
  \entry{Front-end Developer}{Studio Květ, Prague}{2017 -- 2020}{%
    \point{Built responsive websites and interactive data stories for cultural institutions.}}

  \mainsection{Education}
  \entry{M.A.\ Interaction Design}{School of Design, Example University}{2015 -- 2017}{%
    Thesis on inclusive data visualisation for low-vision readers.}
  \entry{B.A.\ Graphic Design}{Academy of Arts, Prague}{2012 -- 2015}{%
    Specialisation in typography and editorial design.}

  \mainsection{Selected projects}
  \entry{Open Type Tester}{Open-source tool}{2024}{%
    A browser tool for comparing variable fonts side by side.}
\end{minipage}

\end{document}
`;

// ---------------------------------------------------------------------------
// Cover letter
// ---------------------------------------------------------------------------

const coverLetterMain = String.raw`% =====================================================================
%  TexIt -- Cover letter
% ---------------------------------------------------------------------
%  A clean one-page letter that pairs with the Modern CV template.
%  Fill in the sender, recipient and position macros below, then write
%  the body of the letter.
%  Engine: pdfLaTeX.
% =====================================================================
\documentclass[11pt,a4paper]{article}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\renewcommand*{\familydefault}{\sfdefault}
\usepackage{microtype}
\usepackage[a4paper,margin=2.3cm,top=1.8cm]{geometry}
\usepackage{xcolor}
\usepackage{parskip}
\usepackage[hidelinks]{hyperref}

\definecolor{accent}{HTML}{BE123C}
\definecolor{ink}{HTML}{1F2937}
\definecolor{muted}{HTML}{6B7280}
\pagestyle{empty}

% ---- Sender ----------------------------------------------------------------
\newcommand{\sendername}{Alex Rivera}
\newcommand{\sendertitle}{Senior Software Engineer}
\newcommand{\senderemail}{alex.rivera@example.com}
\newcommand{\senderphone}{+1 (555) 012-3456}
\newcommand{\senderlocation}{Portland, OR}

% ---- Recipient and position ---------------------------------------------------
\newcommand{\recipientname}{Dr.~Morgan Chen}
\newcommand{\recipienttitle}{Head of Engineering}
\newcommand{\recipientcompany}{Northwind Analytics}
\newcommand{\recipientaddress}{410 Market Street\\San Francisco, CA 94111}
\newcommand{\jobtitle}{Staff Engineer, Data Platform}

\begin{document}
\color{ink}

% ---- Letterhead -----------------------------------------------------------------
{\fontsize{24}{28}\selectfont\bfseries \sendername\par}
\vspace{2pt}
{\large\color{accent}\sendertitle\par}
\vspace{4pt}
{\small\color{muted}\senderemail\quad\textbar\quad\senderphone\quad\textbar\quad\senderlocation\par}
\vspace{2pt}
{\color{accent}\rule{\linewidth}{1pt}\par}
\vspace{1.5em}

% ---- Date and recipient ------------------------------------------------------------
\today

\begin{tabular}{@{}l@{}}
  \textbf{\recipientname} \\
  \recipienttitle \\
  \recipientcompany \\
  \recipientaddress
\end{tabular}

\vspace{0.5em}
\textbf{Application for the position of \jobtitle}

Dear \recipientname,

I am writing to apply for the \jobtitle{} position at \recipientcompany. For
the past eight years I have built data platforms that teams rely on every day,
and the opportunity to shape the next generation of your analytics stack is
exactly the kind of challenge I am looking for.

At Lumen Health I lead a team of five engineers responsible for a real-time
analytics platform that processes two billion events per day. By redesigning
our query layer around pre-aggregated tables we cut dashboard load times by
70\,\%, and the design reviews and on-call handbook I introduced have since
been adopted by four other teams.

What draws me to \recipientcompany{} is your commitment to making data
accessible to people who are not specialists. I would bring deep experience
with distributed systems together with a genuine enthusiasm for clear, honest
data visualisation. I would welcome the chance to discuss how I could
contribute to your team.

Thank you for your time and consideration.

Kind regards,

\vspace{2.5em}
\textbf{\sendername}

\vfill
{\small\color{muted}Enclosures: curriculum vitae, portfolio}

\end{document}
`;

// ---------------------------------------------------------------------------
// Book
// ---------------------------------------------------------------------------

const bookMain = String.raw`% =====================================================================
%  TexIt -- Book
% ---------------------------------------------------------------------
%  The book class with front matter (roman page numbers, preface,
%  contents), main matter organised in parts and chapters, and back
%  matter (afterword, glossary). The page size is a 6 x 9 inch trade
%  paperback; change the geometry options for A4 or US Letter.
%  Engine: pdfLaTeX.
% =====================================================================
\documentclass[11pt,twoside,openright]{book}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{microtype}
\usepackage[paperwidth=6in,paperheight=9in,inner=0.85in,outer=0.65in,
  top=0.8in,bottom=0.9in,headheight=14pt]{geometry}
\usepackage{xcolor}
\usepackage{titlesec}
\usepackage{fancyhdr}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}

\definecolor{bookaccent}{HTML}{92400E}
\newcommand{\booktitle}{The Lighthouse Keeper's Almanac}
\newcommand{\bookauthor}{Eleanor Marsh}

% ---- Headings ----------------------------------------------------------------
\titleformat{\part}[display]
  {\normalfont\centering}
  {\Large\scshape\color{bookaccent}\partname\ \thepart}
  {1em}
  {\Huge\itshape}
\titleformat{\chapter}[display]
  {\normalfont\centering}
  {\large\scshape\color{bookaccent}\chaptertitlename\ \thechapter}
  {0.8em}
  {\Huge\itshape}
  [\vspace{0.8em}{\color{bookaccent}\rule{0.25\textwidth}{0.6pt}}]
\titlespacing*{\chapter}{0pt}{1.5cm}{2cm}
\titleformat{\section}{\normalfont\large\bfseries}{\thesection}{1em}{}

% ---- Running heads: book title on the left, chapter title on the right --------
\pagestyle{fancy}
\fancyhf{}
\fancyhead[LE,RO]{\small\thepage}
\fancyhead[CE]{\small\scshape\booktitle}
\fancyhead[CO]{\small\scshape\nouppercase{\leftmark}}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\chaptermark}[1]{\markboth{#1}{}}
\fancypagestyle{plain}{\fancyhf{}\fancyfoot[C]{\small\thepage}}

% An epigraph: \bookepigraph{quotation}{source}
\newcommand{\bookepigraph}[2]{%
  \begin{flushright}
    \begin{minipage}{0.7\textwidth}
      \raggedleft\itshape #1\par
      \vspace{0.3em}\upshape\small --- #2
    \end{minipage}
  \end{flushright}
  \vspace{1.5em}}

\begin{document}

% ===================== Front matter =====================
\frontmatter

\begin{titlepage}
  \centering
  \vspace*{2.5cm}
  {\Huge\itshape The Lighthouse Keeper's\\[0.3em] Almanac\par}
  \vspace{1.2em}
  {\color{bookaccent}\rule{0.3\textwidth}{0.6pt}\par}
  \vspace{1.2em}
  {\large\scshape Stories of light, weather and the sea\par}
  \vfill
  {\Large \bookauthor\par}
  \vspace{2cm}
  {\small\scshape Harbour Press\par}
\end{titlepage}

\thispagestyle{empty}
\vspace*{\fill}
{\small\noindent
  Copyright \copyright{} 2026 \bookauthor\\
  All rights reserved.\\[1em]
  Typeset with \LaTeX{} in TexIt.\\[1em]
  First edition\par}
\cleardoublepage

\thispagestyle{empty}
\vspace*{4cm}
\begin{center}
  \itshape For everyone who keeps a light on.
\end{center}
\cleardoublepage

\tableofcontents

\chapter{Preface}
\markboth{Preface}{}
This book began as a notebook kept during three winters on a small island
off the northern coast. Each evening, after the lamp was lit and the log
written up, I added a few lines about the weather, the ships and the
peculiar rhythm of a life organised around darkness.

The chapters that follow are arranged loosely by season. They can be read
in any order, much as one might open an almanac at random to see what the
tide will do tomorrow.

% ===================== Main matter =====================
\mainmatter

\part{Light}

\chapter{The Keeper}
\bookepigraph{A lighthouse is not interested in who gets its light.}{Old harbour saying}

The previous keeper left me a list of instructions pinned to the kitchen
door. Most concerned the lamp: trim the wick, polish the brass, wind the
clockwork every four hours. The last line, underlined twice, simply said
\emph{never trust a calm sea in March}.

\section{A morning routine}
The day starts in the dark. Before dawn the lamp must be extinguished, the
lens curtained against the sun, and the weather recorded: wind direction,
barometer, visibility, the colour of the sky over the eastern headland.

\section{Visitors}
The supply boat came every second Thursday, weather permitting. Its arrival
was the closest thing the island had to a festival.

\chapter{Lenses and Lamps}
A Fresnel lens is a beautiful object: concentric rings of glass that bend
the light of a single flame into a beam visible thirty kilometres away. Ours
was built in 1872 and still turned on its original bed of mercury.

% --------------------------------------------------------------------------
\part{Weather}

\chapter{Reading the Sky}
Fishermen on the island read the sky the way others read a newspaper.
High, thin clouds drifting in from the west meant a change within a day;
a ring around the moon meant rain before morning.

\chapter{The Great Storm}
\bookepigraph{The sea has never been friendly to man. At most it has been the accomplice of human restlessness.}{Joseph Conrad}

The storm arrived on the night of the equinox. By midnight the spray was
reaching the gallery, forty metres above the waterline, and the whole tower
hummed like a struck bell.

% ===================== Back matter =====================
\backmatter

\chapter{Afterword}
\markboth{Afterword}{}
The light was automated two years after I left. It still flashes twice
every fifteen seconds, but nobody climbs the stairs at dusk any more.

\chapter{Glossary}
\markboth{Glossary}{}
\begin{description}[leftmargin=0pt,itemsep=0.4em]
  \item[Fresnel lens] A lens made of concentric prisms that focuses light into a narrow beam.
  \item[Gallery] The external walkway around the top of a lighthouse.
  \item[Light characteristic] The pattern of flashes that identifies a lighthouse at night.
\end{description}

\end{document}
`;

// ---------------------------------------------------------------------------
// Homework
// ---------------------------------------------------------------------------

const homeworkMain = String.raw`% =====================================================================
%  TexIt -- Homework / problem set
% ---------------------------------------------------------------------
%  Put each exercise in a problem environment and its answer in a
%  solution environment (it ends with a QED square). Set the course,
%  the assignment and your name in the macros below.
%  Engine: pdfLaTeX.
% =====================================================================
\documentclass[11pt,letterpaper]{article}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{microtype}
\usepackage[margin=1in,headheight=14pt]{geometry}
\usepackage{amsmath,amssymb,amsthm,mathtools}
\usepackage{enumitem}
\usepackage{xcolor}
\usepackage{fancyhdr}
\usepackage{listings}
\usepackage[hidelinks]{hyperref}

% ---- Assignment details -------------------------------------------------
\newcommand{\course}{MATH 2410: Calculus and Linear Algebra}
\newcommand{\assignment}{Problem Set 3}
\newcommand{\student}{Sam Taylor}
\newcommand{\duedate}{October 14, 2026}

\definecolor{hwaccent}{HTML}{15803D}

% ---- Header and footer ------------------------------------------------------
\pagestyle{fancy}
\fancyhf{}
\fancyhead[L]{\small\course}
\fancyhead[R]{\small\student}
\fancyfoot[C]{\small\thepage}
\renewcommand{\headrulewidth}{0.4pt}

% ---- Problems and solutions ---------------------------------------------------
\theoremstyle{definition}
\newtheorem{problem}{Problem}
\newenvironment{solution}{\begin{proof}[Solution]}{\end{proof}}

% ---- Shortcuts -------------------------------------------------------------------
\newcommand{\R}{\mathbb{R}}
\newcommand{\N}{\mathbb{N}}
\DeclarePairedDelimiter{\abs}{\lvert}{\rvert}

% ---- Code listings -----------------------------------------------------------------
\lstset{
  language=Python,
  basicstyle=\ttfamily\small,
  keywordstyle=\color{hwaccent}\bfseries,
  commentstyle=\color{gray}\itshape,
  stringstyle=\color{orange!70!black},
  numbers=left, numberstyle=\tiny\color{gray},
  frame=single, rulecolor=\color{gray!40},
  xleftmargin=2em, framexleftmargin=1.5em,
  columns=fullflexible, keepspaces=true}

\begin{document}

\begin{center}
  {\Large\bfseries \assignment\par}
  \vspace{0.4em}
  {\course\par}
  \vspace{0.3em}
  {\small \student \quad\textbullet\quad Due \duedate\par}
\end{center}
{\color{hwaccent}\hrule height 0.8pt}
\vspace{1em}

% -------------------------------------------------------------------------
\begin{problem}
  Evaluate $\displaystyle\int_0^1 x e^{x}\,\mathrm{d}x$.
\end{problem}
\begin{solution}
  Integrating by parts with $u = x$ and $\mathrm{d}v = e^x\,\mathrm{d}x$,
  \begin{align*}
    \int_0^1 x e^{x}\,\mathrm{d}x
      &= \Bigl[x e^{x}\Bigr]_0^1 - \int_0^1 e^{x}\,\mathrm{d}x \\
      &= e - (e - 1) = 1. \qedhere
  \end{align*}
\end{solution}

% -------------------------------------------------------------------------
\begin{problem}
  Prove that for every $n \in \N$,
  \[ \sum_{k=1}^{n} k^2 = \frac{n(n+1)(2n+1)}{6}. \]
\end{problem}
\begin{solution}
  We use induction on $n$. For $n = 1$ both sides equal $1$. Assume the
  identity holds for some $n \ge 1$. Then
  \begin{align*}
    \sum_{k=1}^{n+1} k^2
      &= \frac{n(n+1)(2n+1)}{6} + (n+1)^2
       = \frac{(n+1)\bigl(2n^2 + 7n + 6\bigr)}{6} \\
      &= \frac{(n+1)(n+2)(2n+3)}{6},
  \end{align*}
  which is the claim for $n+1$. By induction the identity holds for all
  $n \in \N$.
\end{solution}

% -------------------------------------------------------------------------
\begin{problem}
  Let $A = \begin{pmatrix} 2 & 1 \\ 1 & 2 \end{pmatrix}$.
  \begin{enumerate}[label=(\alph*)]
    \item Find the eigenvalues of $A$.
    \item Find an eigenvector for each eigenvalue.
    \item Compute $A^{10}$.
  \end{enumerate}
\end{problem}
\begin{solution}
  \begin{enumerate}[label=(\alph*)]
    \item The characteristic polynomial is
          $\det(A - \lambda I) = (2-\lambda)^2 - 1 = (\lambda - 1)(\lambda - 3)$,
          so the eigenvalues are $\lambda_1 = 1$ and $\lambda_2 = 3$.
    \item Solving $(A - \lambda I)v = 0$ gives $v_1 = (1,-1)^\top$ for
          $\lambda_1 = 1$ and $v_2 = (1,1)^\top$ for $\lambda_2 = 3$.
    \item Diagonalising $A = PDP^{-1}$ with $P = (v_1\; v_2)$ yields
          \[
            A^{n} = \frac{1}{2}\begin{pmatrix} 3^n + 1 & 3^n - 1 \\ 3^n - 1 & 3^n + 1 \end{pmatrix},
            \qquad
            A^{10} = \begin{pmatrix} 29525 & 29524 \\ 29524 & 29525 \end{pmatrix}. \qedhere
          \]
  \end{enumerate}
\end{solution}

% -------------------------------------------------------------------------
\begin{problem}
  Two fair dice are rolled. What is the probability that their sum is $7$,
  given that at least one die shows a $3$?
\end{problem}
\begin{solution}
  Of the $36$ equally likely outcomes, $11$ contain at least one $3$. Among
  them only $(3,4)$ and $(4,3)$ have sum $7$. Hence
  \[ P(\text{sum} = 7 \mid \text{at least one } 3) = \frac{2}{11}. \qedhere \]
\end{solution}

% -------------------------------------------------------------------------
\begin{problem}
  Write a program that approximates $\sqrt{2}$ with Newton's method and
  state how many iterations are needed for an error below $10^{-12}$.
\end{problem}
\begin{solution}
  Newton's method for $f(x) = x^2 - 2$ gives
  $x_{k+1} = \tfrac{1}{2}\bigl(x_k + 2/x_k\bigr)$:
\begin{lstlisting}
def newton_sqrt2(x=1.0, tol=1e-12):
    steps = 0
    while abs(x * x - 2) > tol:
        x = 0.5 * (x + 2 / x)   # Newton update
        steps += 1
    return x, steps

print(newton_sqrt2())  # (1.414213562373095, 5)
\end{lstlisting}
  Starting from $x_0 = 1$, five iterations suffice because the number of
  correct digits roughly doubles at each step.
\end{solution}

\end{document}
`;

// ---------------------------------------------------------------------------
// Lab report
// ---------------------------------------------------------------------------

const labReportMain = String.raw`% =====================================================================
%  TexIt -- Lab report
% ---------------------------------------------------------------------
%  An experiment write-up with siunitx for numbers and units, a
%  booktabs table with decimal-aligned S columns, a pgfplots graph
%  whose data are written inline, and an uncertainty analysis.
%  Engine: pdfLaTeX.
% =====================================================================
\documentclass[11pt,a4paper]{article}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{microtype}
\usepackage[margin=2.4cm]{geometry}
\usepackage{amsmath}
\usepackage{siunitx}
\sisetup{per-mode=symbol,uncertainty-mode=separate}
\usepackage{booktabs}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\usepackage[font=small,labelfont=bf]{caption}
\usepackage{xcolor}
\usepackage[hidelinks]{hyperref}
\usepackage[capitalise]{cleveref}

\definecolor{labblue}{HTML}{0E7490}
\definecolor{laborange}{HTML}{EA580C}

\title{\textbf{Measuring the Gravitational Acceleration\\with a Simple Pendulum}}
\author{Physics 101 -- Laboratory 2\\[0.3em]
  \small Chen Wei \and \small Amara Diallo \and \small Lukas Berg}
\date{\today}

\begin{document}
\maketitle

\section{Aim}
To determine the local gravitational acceleration $g$ from the period of a
simple pendulum of varying length, and to estimate the uncertainty of the
result.

\section{Theory}
For small amplitudes, a pendulum of length $L$ oscillates with period
\begin{equation}
  T = 2\pi\sqrt{\frac{L}{g}}
  \qquad\Longrightarrow\qquad
  T^2 = \frac{4\pi^2}{g}\,L .
  \label{eq:period}
\end{equation}
A plot of $T^2$ against $L$ is therefore a straight line through the origin
with slope $m = 4\pi^2/g$.

\section{Method}
A steel bob of mass \qty{52.3}{\gram} was suspended from a rigid clamp by a
light string. For seven lengths between \qty{0.20}{\metre} and
\qty{0.80}{\metre} we released the bob from an angle below \ang{10} and timed
20 complete oscillations with a stopwatch. The length was measured with a
metre rule to within \qty{1}{\milli\metre}, and the reaction-time uncertainty of
each timing was estimated as \qty{0.2}{\second}.

\section{Results}
The measurements are listed in \cref{tab:data} and plotted in
\cref{fig:fit}.

\begin{table}[htbp]
  \centering
  \caption{Measured lengths and timings. The period is the time for
    20 oscillations divided by 20, so $\sigma_T = \qty{0.010}{\second}$.}
  \label{tab:data}
  \begin{tabular}{@{}S[table-format=1.3]S[table-format=2.2]S[table-format=1.3]
                  S[table-format=1.3]S[table-format=1.3]@{}}
    \toprule
    {$L$ (\unit{\metre})} & {$t_{20}$ (\unit{\second})} & {$T$ (\unit{\second})}
      & {$T^2$ (\unit{\second\squared})} & {$\sigma_{T^2}$ (\unit{\second\squared})} \\
    \midrule
    0.200 & 18.04 & 0.902 & 0.814 & 0.018 \\
    0.300 & 21.90 & 1.095 & 1.199 & 0.022 \\
    0.400 & 25.42 & 1.271 & 1.615 & 0.025 \\
    0.500 & 28.30 & 1.415 & 2.002 & 0.028 \\
    0.600 & 31.14 & 1.557 & 2.424 & 0.031 \\
    0.700 & 33.52 & 1.676 & 2.809 & 0.034 \\
    0.800 & 35.94 & 1.797 & 3.229 & 0.036 \\
    \bottomrule
  \end{tabular}
\end{table}

\begin{figure}[htbp]
  \centering
  \begin{tikzpicture}
    \begin{axis}[
        width=0.8\linewidth, height=6.5cm,
        xlabel={Length $L$ (\unit{\metre})},
        ylabel={$T^2$ (\unit{\second\squared})},
        xmin=0.1, xmax=0.9, ymin=0, ymax=3.6,
        grid=major, grid style={gray!20},
        legend pos=north west, legend cell align=left]
      \addplot[only marks, mark=*, mark size=1.8pt, color=labblue,
               error bars/.cd, y dir=both, y explicit]
        table[x=L, y=T2, y error=dT2] {
          L      T2     dT2
          0.200  0.814  0.018
          0.300  1.199  0.022
          0.400  1.615  0.025
          0.500  2.002  0.028
          0.600  2.424  0.031
          0.700  2.809  0.034
          0.800  3.229  0.036
        };
      \addlegendentry{Measurements}
      \addplot[laborange, thick, domain=0.15:0.85, samples=2] {4.027*x - 0.0003};
      \addlegendentry{Least-squares fit}
    \end{axis}
  \end{tikzpicture}
  \caption{Square of the period against pendulum length, with the
    least-squares straight line.}
  \label{fig:fit}
\end{figure}

\section{Analysis}
A least-squares fit to the data gives a slope
$m = \qty{4.027 \pm 0.019}{\second\squared\per\metre}$ and an intercept
compatible with zero, as predicted by \cref{eq:period}. Solving for $g$,
\begin{equation}
  g = \frac{4\pi^2}{m} = \qty{9.80}{\metre\per\second\squared}.
\end{equation}
Since $g$ depends only on $m$, its relative uncertainty equals that of the
slope:
\begin{equation}
  \frac{\sigma_g}{g} = \frac{\sigma_m}{m} = \frac{0.019}{4.027} \approx \num{0.47}\,\%,
  \qquad
  \sigma_g \approx \qty{0.05}{\metre\per\second\squared}.
\end{equation}
Our final result is therefore
\begin{equation}
  g = \qty{9.80 \pm 0.05}{\metre\per\second\squared},
\end{equation}
which agrees with the accepted local value of
\qty{9.81}{\metre\per\second\squared} well within one standard uncertainty.

\section{Discussion}
The dominant source of uncertainty is human reaction time when starting and
stopping the stopwatch; timing 20 oscillations instead of one reduces its
effect twenty-fold. Systematic effects include the finite size of the bob,
which slightly increases the effective length, and air resistance, which
damps the motion but changes the period only negligibly at small amplitudes.

\section{Conclusion}
The simple pendulum yields $g = \qty{9.80 \pm 0.05}{\metre\per\second\squared}$,
consistent with the accepted value. Using a light gate instead of a
stopwatch would reduce the uncertainty further.

\end{document}
`;

// ---------------------------------------------------------------------------
// IEEE conference paper
// ---------------------------------------------------------------------------

const ieeeMain = String.raw`% =====================================================================
%  TexIt -- IEEE conference paper (IEEEtran)
% ---------------------------------------------------------------------
%  Two-column IEEE layout from the official IEEEtran class. References
%  are processed by BibTeX with the IEEEtran style (IEEEtran.bst ships
%  with TeX Live) from references.bib. Replace "conference" with
%  "journal" in the class options for the journal layout.
%  Engine: pdfLaTeX + BibTeX.
% =====================================================================
\documentclass[conference]{IEEEtran}
\IEEEoverridecommandlockouts

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb,amsfonts}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{xcolor}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\usepackage[hidelinks]{hyperref}

\begin{document}

\title{Energy-Aware Scheduling for Deep Learning\\Inference on Battery-Powered Edge Devices}

\author{
  \IEEEauthorblockN{Ana Souza}
  \IEEEauthorblockA{\textit{Department of Electrical Engineering}\\
    \textit{Example University}\\
    Lisbon, Portugal\\
    ana.souza@example.edu}
  \and
  \IEEEauthorblockN{Wei Zhang}
  \IEEEauthorblockA{\textit{Embedded Systems Laboratory}\\
    \textit{Example Institute of Technology}\\
    Shenzhen, China\\
    wei.zhang@example.edu}
}

\maketitle

\begin{abstract}
Running neural networks directly on battery-powered devices avoids network
latency and protects privacy, but quickly drains the battery. We present a
lightweight scheduler that selects the processor frequency for each
inference request so as to minimise energy while meeting a latency deadline.
On three representative models, the scheduler reduces energy per inference
by 32--34\,\% compared with a race-to-idle policy, while keeping the
deadline-miss rate below 0.5\,\%.
\end{abstract}

\begin{IEEEkeywords}
edge computing, deep learning inference, dynamic voltage and frequency
scaling, energy efficiency, real-time scheduling
\end{IEEEkeywords}

\section{Introduction}
\IEEEPARstart{D}{eep} neural networks are increasingly deployed on mobile
and embedded devices \cite{lane2016deepx}, where they enable applications
from keyword spotting to visual inspection. Edge computing keeps data close
to where it is produced \cite{shi2016edge}, but energy becomes the scarcest
resource. Model compression reduces the cost of each inference
\cite{han2016deep}; in this paper we instead ask \emph{how} to execute a
given model as efficiently as possible.

\section{Related Work}
Partitioning computation between device and cloud can reduce latency and
energy \cite{kang2017neurosurgeon}, but it requires connectivity. Dynamic
voltage and frequency scaling (DVFS) trades execution time for power and is
available on almost every modern system-on-chip.

\section{System Model}
Let a request $j$ arrive at time $a_j$ with deadline $d_j$. Executing it at
frequency $f$ takes $t_j(f) = c_j / f$ seconds, where $c_j$ is the number of
cycles, and draws power $P(f) = P_{\text{static}} + \kappa f^3$. The energy of
the request is
\begin{equation}
  E_j(f) = P(f)\, t_j(f) = \frac{P_{\text{static}}\, c_j}{f} + \kappa\, c_j f^2 .
  \label{eq:energy}
\end{equation}
We choose the frequency that minimises \eqref{eq:energy} subject to the
deadline,
\begin{equation}
  f_j^{\star} = \arg\min_{f \in \mathcal{F}} E_j(f)
  \quad \text{s.t.} \quad a_j + t_j(f) \le d_j ,
  \label{eq:problem}
\end{equation}
where $\mathcal{F}$ is the set of available frequencies. Problem
\eqref{eq:problem} is convex in $f$ \cite{boyd2004convex}; its unconstrained
optimum is $f = \bigl(P_{\text{static}}/(2\kappa)\bigr)^{1/3}$.

\section{Proposed Scheduler}
At every arrival the scheduler (i) estimates $c_j$ from a per-layer cost
model, (ii) evaluates \eqref{eq:energy} for each frequency in $\mathcal{F}$
that meets the deadline, and (iii) selects the cheapest. The decision takes
less than 20\,$\mu$s on the target processor.

\section{Evaluation}
We evaluated the scheduler on a development board with an eight-core ARM
processor and 14 frequency levels. Fig.~\ref{fig:energy} shows the energy per
inference and Table~\ref{tab:latency} the latency statistics for a deadline of
50\,ms.

\begin{figure}[t]
  \centering
  \begin{tikzpicture}
    \begin{axis}[
        width=\columnwidth, height=4.8cm,
        ybar, bar width=7pt,
        symbolic x coords={MobileNetV2,ResNet-18,BERT-tiny},
        xtick=data, ymin=0, ymax=110,
        enlarge x limits=0.25,
        ylabel={Energy per inference (mJ)},
        legend style={at={(0.5,1.03)},anchor=south,legend columns=-1,draw=none,font=\footnotesize},
        tick label style={font=\footnotesize},
        label style={font=\footnotesize}]
      \addplot[fill=blue!55!black, draw=none]
        coordinates {(MobileNetV2,41.2) (ResNet-18,96.5) (BERT-tiny,63.8)};
      \addplot[fill=orange!85!black, draw=none]
        coordinates {(MobileNetV2,33.0) (ResNet-18,79.1) (BERT-tiny,52.4)};
      \addplot[fill=teal!70!black, draw=none]
        coordinates {(MobileNetV2,27.4) (ResNet-18,64.9) (BERT-tiny,43.1)};
      \legend{Race-to-idle, Static DVFS, Ours}
    \end{axis}
  \end{tikzpicture}
  \caption{Average energy per inference (lower is better).}
  \label{fig:energy}
\end{figure}

\begin{table}[t]
  \caption{Latency and deadline-miss rate for a 50\,ms deadline}
  \label{tab:latency}
  \centering
  \begin{tabular}{@{}lccc@{}}
    \toprule
    Scheduler    & Mean (ms) & P99 (ms) & Misses (\%) \\
    \midrule
    Race-to-idle & 18.2 & 31.5 & 0.0 \\
    Static DVFS  & 29.7 & 58.3 & 4.1 \\
    Ours         & 24.6 & 46.9 & 0.3 \\
    \bottomrule
  \end{tabular}
\end{table}

Race-to-idle has the lowest latency but wastes energy at the highest
frequency. A static frequency saves energy but misses many deadlines when
requests arrive in bursts. Our scheduler adapts to each request and achieves
the lowest energy with almost no missed deadlines.

\section{Conclusion}
A simple per-request frequency selection based on an analytical energy model
saves about one third of the energy of on-device inference without
sacrificing responsiveness. Future work will extend the model to
heterogeneous processors that include neural accelerators.

\section*{Acknowledgment}
The authors thank the anonymous reviewers for their helpful comments.

\bibliographystyle{IEEEtran}
\bibliography{references}

\end{document}
`;

const ieeeBib = String.raw`% Bibliography database (BibTeX, style IEEEtran).

@inproceedings{han2016deep,
  author    = {Han, Song and Mao, Huizi and Dally, William J.},
  title     = {Deep Compression: Compressing Deep Neural Networks with Pruning, Trained Quantization and {Huffman} Coding},
  booktitle = {Proc. Int. Conf. Learning Representations (ICLR)},
  year      = {2016}
}

@inproceedings{lane2016deepx,
  author    = {Lane, Nicholas D. and Bhattacharya, Sourav and Georgiev, Petko and Forlivesi, Claudio and Jiao, Lei and Qendro, Lorena and Kawsar, Fahim},
  title     = {{DeepX}: A Software Accelerator for Low-Power Deep Learning Inference on Mobile Devices},
  booktitle = {Proc. 15th ACM/IEEE Int. Conf. Information Processing in Sensor Networks (IPSN)},
  pages     = {1--12},
  year      = {2016}
}

@article{shi2016edge,
  author  = {Shi, Weisong and Cao, Jie and Zhang, Quan and Li, Youhuizi and Xu, Lanyu},
  title   = {Edge Computing: Vision and Challenges},
  journal = {IEEE Internet of Things Journal},
  volume  = {3},
  number  = {5},
  pages   = {637--646},
  year    = {2016}
}

@inproceedings{kang2017neurosurgeon,
  author    = {Kang, Yiping and Hauswald, Johann and Gao, Cao and Rovinski, Austin and Mudge, Trevor and Mars, Jason and Tang, Lingjia},
  title     = {Neurosurgeon: Collaborative Intelligence Between the Cloud and Mobile Edge},
  booktitle = {Proc. 22nd Int. Conf. Architectural Support for Programming Languages and Operating Systems (ASPLOS)},
  pages     = {615--629},
  year      = {2017}
}

@book{boyd2004convex,
  author    = {Boyd, Stephen and Vandenberghe, Lieven},
  title     = {Convex Optimization},
  publisher = {Cambridge University Press},
  year      = {2004}
}
`;

// ---------------------------------------------------------------------------
// Math lecture notes (tcolorbox theorems)
// ---------------------------------------------------------------------------

const mathNotesMain = String.raw`% =====================================================================
%  TexIt -- Lecture notes with coloured theorem boxes
% ---------------------------------------------------------------------
%  Definitions, theorems, lemmas, corollaries and examples are
%  tcolorbox theorems that break across pages. Use them as
%    \begin{theorem}{Optional title}{label} ... \end{theorem}
%  and refer to them with \ref{thm:label} (prefixes: def, thm, lem,
%  cor, ex). Starred versions such as theorem* are unnumbered.
%  Proofs use the amsthm proof environment.
%  Engine: pdfLaTeX.
% =====================================================================
\documentclass[11pt,a4paper]{article}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{microtype}
\usepackage[margin=2.5cm,headheight=14pt]{geometry}
\usepackage{amsmath,amssymb,amsthm,mathtools}
\usepackage{xcolor}
\usepackage[skins,breakable,theorems]{tcolorbox}
\usepackage{enumitem}
\usepackage{fancyhdr}
\usepackage{tikz}
\usetikzlibrary{arrows.meta}
\usepackage[colorlinks=true,linkcolor=blue!60!black,urlcolor=blue!60!black]{hyperref}

% ---- Colours ---------------------------------------------------------------
\definecolor{thmblue}{HTML}{1D4ED8}
\definecolor{defgreen}{HTML}{047857}
\definecolor{exorange}{HTML}{C2410C}

% ---- Theorem boxes ------------------------------------------------------------
\tcbset{
  notebox/.style={
    enhanced, breakable,
    colback=#1!4, colframe=#1, coltitle=#1!85!black,
    boxrule=0pt, leftrule=2.5pt, arc=0pt, outer arc=0pt,
    left=8pt, right=8pt, top=6pt, bottom=6pt,
    fonttitle=\bfseries,
    separator sign none,
    description delimiters parenthesis,
    attach title to upper={.\ },
    before skip=12pt, after skip=12pt}}

\newtcbtheorem[number within=section]{definition}{Definition}{notebox=defgreen}{def}
\newtcbtheorem[use counter from=definition]{theorem}{Theorem}{notebox=thmblue}{thm}
\newtcbtheorem[use counter from=definition]{lemma}{Lemma}{notebox=thmblue}{lem}
\newtcbtheorem[use counter from=definition]{corollary}{Corollary}{notebox=thmblue}{cor}
\newtcbtheorem[use counter from=definition]{example}{Example}{notebox=exorange}{ex}

\theoremstyle{remark}
\newtheorem*{remark}{Remark}

% ---- Header -------------------------------------------------------------------
\pagestyle{fancy}
\fancyhf{}
\fancyhead[L]{\small\textsc{Linear Algebra II}}
\fancyhead[R]{\small Lecture 7: Eigenvalues and Diagonalisation}
\fancyfoot[C]{\small\thepage}
\renewcommand{\headrulewidth}{0.4pt}

% ---- Shortcuts -------------------------------------------------------------------
\newcommand{\R}{\mathbb{R}}
\DeclareMathOperator{\diag}{diag}

\begin{document}

\begin{tcolorbox}[enhanced, colback=thmblue, colframe=thmblue, coltext=white,
    arc=4pt, boxrule=0pt, left=14pt, right=14pt, top=12pt, bottom=12pt]
  {\small\scshape Linear Algebra II \hfill Lecture 7 \quad\textbullet\quad 7 October 2026}\par
  \medskip
  {\LARGE\bfseries Eigenvalues and Diagonalisation\par}
  \medskip
  {\small Lecturer: Dr.~Noor Haddad \hfill Notes by: Your Name}
\end{tcolorbox}

\section{Eigenvalues and eigenvectors}

\begin{definition}{Eigenpair}{eigenpair}
  Let $A \in \R^{n\times n}$. A scalar $\lambda$ is an \emph{eigenvalue} of
  $A$ if there is a non-zero vector $v \in \R^n$ such that
  \[ A v = \lambda v . \]
  The vector $v$ is called an \emph{eigenvector} for $\lambda$.
\end{definition}

Geometrically, an eigenvector is a direction that $A$ only stretches (or
flips), without rotating it.

\begin{center}
  \begin{tikzpicture}[scale=0.55,>={Stealth[length=2.5mm]}]
    \draw[->,gray] (-0.5,0) -- (6,0) node[right] {$x_1$};
    \draw[->,gray] (0,-4.5) -- (0,6) node[above] {$x_2$};
    \draw[->,thick,dashed,thmblue!50] (0,0) -- (5,5) node[right] {$Av = 5v$};
    \draw[->,very thick,thmblue] (0,0) -- (1,1) node[above left] {$v$};
    \draw[->,thick,dashed,exorange!50] (0,0) -- (2,-4) node[right] {$Aw = 2w$};
    \draw[->,very thick,exorange] (0,0) -- (1,-2) node[left] {$w$};
  \end{tikzpicture}
\end{center}

\begin{example}{A $2\times 2$ matrix}{twobytwo}
  For $A = \begin{pmatrix} 4 & 1 \\ 2 & 3 \end{pmatrix}$ we have
  $A\begin{pmatrix}1\\1\end{pmatrix} = 5\begin{pmatrix}1\\1\end{pmatrix}$ and
  $A\begin{pmatrix}1\\-2\end{pmatrix} = 2\begin{pmatrix}1\\-2\end{pmatrix}$,
  so $5$ and $2$ are eigenvalues of $A$.
\end{example}

\section{The characteristic polynomial}

\begin{definition}{Characteristic polynomial}{charpoly}
  The \emph{characteristic polynomial} of $A \in \R^{n\times n}$ is
  $p_A(\lambda) = \det(A - \lambda I)$, a polynomial of degree $n$.
\end{definition}

\begin{lemma}{}{roots}
  $\lambda$ is an eigenvalue of $A$ if and only if $p_A(\lambda) = 0$.
\end{lemma}
\begin{proof}
  $Av = \lambda v$ for some $v \ne 0$ if and only if $(A - \lambda I)v = 0$
  has a non-trivial solution, that is, if and only if $A - \lambda I$ is
  singular, which happens exactly when $\det(A - \lambda I) = 0$.
\end{proof}

For the matrix of Example~\ref{ex:twobytwo},
$p_A(\lambda) = \lambda^2 - 7\lambda + 10 = (\lambda - 5)(\lambda - 2)$,
confirming the eigenvalues found there.

\section{Diagonalisation}

\begin{theorem}{Distinct eigenvalues}{distinct}
  Eigenvectors $v_1, \dots, v_k$ belonging to pairwise distinct eigenvalues
  $\lambda_1, \dots, \lambda_k$ are linearly independent.
\end{theorem}
\begin{proof}
  By induction on $k$; the case $k = 1$ holds since $v_1 \ne 0$. Suppose
  $\sum_{i=1}^{k} c_i v_i = 0$. Applying $A - \lambda_k I$ gives
  $\sum_{i=1}^{k-1} c_i(\lambda_i - \lambda_k)v_i = 0$. By the induction
  hypothesis $c_i(\lambda_i - \lambda_k) = 0$, hence $c_i = 0$ for $i < k$
  because the eigenvalues are distinct. Then $c_k v_k = 0$ forces $c_k = 0$.
\end{proof}

\begin{corollary}{}{diagonalisable}
  If $A \in \R^{n\times n}$ has $n$ distinct eigenvalues, then
  $A = PDP^{-1}$ where the columns of $P$ are eigenvectors and
  $D = \diag(\lambda_1, \dots, \lambda_n)$.
\end{corollary}

\begin{example}{Matrix powers}{powers}
  Diagonalisation makes powers cheap: $A^k = PD^kP^{-1}$. For the matrix of
  Example~\ref{ex:twobytwo},
  \[
    P = \begin{pmatrix} 1 & 1 \\ 1 & -2 \end{pmatrix}, \quad
    D = \begin{pmatrix} 5 & 0 \\ 0 & 2 \end{pmatrix}, \quad
    P^{-1} = \frac{1}{3}\begin{pmatrix} 2 & 1 \\ 1 & -1 \end{pmatrix}.
  \]
\end{example}

\begin{theorem*}{Spectral theorem}{}
  Every real symmetric matrix is diagonalisable by an orthogonal matrix:
  $A = QDQ^\top$ with $Q^\top Q = I$.
\end{theorem*}

\begin{remark}
  Theorem~\ref{thm:distinct} gives a sufficient condition only: the identity
  matrix has a single eigenvalue but is already diagonal.
\end{remark}

\section{Exercises}
\begin{enumerate}[label=\textbf{\arabic*.}]
  \item Find the eigenvalues and eigenvectors of
        $\begin{pmatrix} 0 & 1 \\ -2 & 3 \end{pmatrix}$.
  \item Show that $A$ and $A^\top$ have the same characteristic polynomial.
  \item Prove that a matrix is invertible if and only if $0$ is not an eigenvalue.
\end{enumerate}

\end{document}
`;

// ---------------------------------------------------------------------------
// Spanish article
// ---------------------------------------------------------------------------

const articuloEsMain = String.raw`% =====================================================================
%  TexIt -- Artículo en español
% ---------------------------------------------------------------------
%  Plantilla de artículo con babel en español: títulos traducidos
%  (Resumen, Figura, Tabla, Referencias), separación silábica correcta
%  y comillas latinas con \enquote{...}. La opción provide=* carga el
%  idioma desde los archivos .ini de babel (funciona también en el motor
%  del navegador). Las referencias están al final, en el entorno
%  thebibliography.
%  Motor: pdfLaTeX.
% =====================================================================
\documentclass[11pt,a4paper]{article}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[spanish, provide=*]{babel}
\usepackage{lmodern}
\usepackage{microtype}
\usepackage[margin=2.5cm]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{booktabs}
\usepackage{xcolor}
\usepackage{tikz}
\usetikzlibrary{babel}
\usepackage[font=small,labelfont=bf]{caption}
\usepackage{csquotes}

\definecolor{acento}{HTML}{B91C1C}
\usepackage[colorlinks=true,linkcolor=acento,citecolor=acento,urlcolor=acento]{hyperref}

\title{\textbf{Energía solar en comunidades rurales:\\
  costes y beneficios de las microrredes}}
\author{Lucía Fernández Ortega\thanks{Departamento de Ingeniería Energética,
    Universidad de Ejemplo. Correo: \texttt{lucia.fernandez@example.org}}
  \and Javier Morales Ruiz}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
  Cientos de millones de personas seguirán sin acceso a la electricidad en
  2030 si se mantienen las tendencias actuales \cite{sdg7}. En este artículo
  comparamos el coste nivelado de la energía de cuatro alternativas para
  electrificar comunidades rurales aisladas: la extensión de la red, los
  generadores diésel y dos configuraciones de microrred solar fotovoltaica.
  Los resultados muestran que las microrredes solares con almacenamiento ya
  son competitivas frente al diésel en todos los escenarios analizados.

  \medskip
  \noindent\textbf{Palabras clave:} energía solar, microrredes,
  electrificación rural, coste nivelado de la energía.
\end{abstract}

\section{Introducción}
El acceso a una electricidad fiable transforma la vida de una comunidad:
permite conservar alimentos y vacunas, estudiar por la noche y crear
pequeños negocios. Sin embargo, llevar la red eléctrica a pueblos remotos es
caro, y los generadores diésel dependen de un combustible cuyo precio y
suministro son inciertos.

La caída del precio de los módulos fotovoltaicos en la última década
\cite{irena2023} ha cambiado este panorama y ha impulsado lo que se conoce
como \enquote{electrificación descentralizada}: sistemas locales que generan
y distribuyen la energía cerca de donde se consume.

\section{Metodología}
\subsection{Coste nivelado de la energía}
Comparamos las alternativas mediante el coste nivelado de la energía
(LCOE, por sus siglas en inglés), que reparte todos los costes del proyecto
entre la energía que produce a lo largo de su vida útil:
\begin{equation}
  \mathrm{LCOE} = \frac{\displaystyle\sum_{t=0}^{N} \frac{I_t + M_t + F_t}{(1+r)^t}}
                       {\displaystyle\sum_{t=0}^{N} \frac{E_t}{(1+r)^t}},
  \label{eq:lcoe}
\end{equation}
donde $I_t$, $M_t$ y $F_t$ son la inversión, el mantenimiento y el
combustible en el año $t$, $E_t$ es la energía suministrada y $r$ la tasa de
descuento.

\subsection{Supuestos}
La tabla~\ref{tab:supuestos} recoge los principales parámetros del modelo,
basados en datos de mercado de 2023 \cite{irena2023}.

\begin{table}[htbp]
  \centering
  \caption{Supuestos del modelo.}
  \label{tab:supuestos}
  \begin{tabular}{@{}lr@{}}
    \toprule
    Parámetro                         & Valor \\
    \midrule
    Tasa de descuento, $r$            & 8\,\% \\
    Vida útil del proyecto, $N$       & 20 años \\
    Irradiación media                 & 5,2 kWh/m$^2$/día \\
    Coste de los módulos              & 0,35 USD/W \\
    Precio del diésel                 & 1,10 USD/L \\
    \bottomrule
  \end{tabular}
\end{table}

\section{Resultados}
La figura~\ref{fig:lcoe} muestra el LCOE de cada alternativa calculado con
la ecuación~\eqref{eq:lcoe}. La microrred solar con baterías resulta la
opción más económica entre las que garantizan suministro las 24 horas.

\begin{figure}[htbp]
  \centering
  \begin{tikzpicture}[x=30cm,y=0.9cm]
    \fill[acento!35] (0,0) rectangle (0.11,0.6);
    \fill[acento!60] (0,-1) rectangle (0.19,-0.4);
    \fill[gray!50]   (0,-2) rectangle (0.21,-1.4);
    \fill[gray!80]   (0,-3) rectangle (0.38,-2.4);
    \node[anchor=east,font=\small] at (-0.005,0.3)  {Solar sin baterías};
    \node[anchor=east,font=\small] at (-0.005,-0.7) {Solar con baterías};
    \node[anchor=east,font=\small] at (-0.005,-1.7) {Extensión de la red};
    \node[anchor=east,font=\small] at (-0.005,-2.7) {Generador diésel};
    \node[anchor=west,font=\small] at (0.115,0.3)  {0,11};
    \node[anchor=west,font=\small] at (0.195,-0.7) {0,19};
    \node[anchor=west,font=\small] at (0.215,-1.7) {0,21};
    \node[anchor=west,font=\small] at (0.385,-2.7) {0,38};
    \draw[gray] (0,-3.2) -- (0,0.8);
  \end{tikzpicture}
  \caption{Coste nivelado de la energía (USD/kWh) de cada alternativa.}
  \label{fig:lcoe}
\end{figure}

\section{Discusión}
La extensión de la red solo es competitiva a menos de unos 10~km de la línea
existente. La opción solar sin baterías es la más barata, pero solo
suministra energía durante el día, lo que limita su utilidad para hogares y
centros de salud. Los resultados son sensibles al precio del diésel: con
1,50 USD/L, el LCOE del generador supera los 0,50 USD/kWh.

\section{Conclusiones}
Las microrredes solares con almacenamiento ofrecen hoy la forma más barata
de llevar electricidad fiable a comunidades rurales aisladas. Las políticas
públicas deberían centrarse en facilitar su financiación inicial, que es la
principal barrera para su despliegue.

\begin{thebibliography}{9}
  \bibitem{sdg7} IEA, IRENA, UNSD, Banco Mundial y OMS.
    \emph{Tracking SDG 7: The Energy Progress Report}. Banco Mundial,
    Washington D.\,C., 2023.
  \bibitem{irena2023} IRENA. \emph{Renewable Power Generation Costs in 2022}.
    Agencia Internacional de Energías Renovables, Abu Dabi, 2023.
\end{thebibliography}

\end{document}
`;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const templates: ProjectTemplate[] = [
  {
    id: 'blank',
    name: 'Blank document',
    description: 'A minimal article to start from scratch.',
    category: 'basic',
    engine: 'pdflatex',
    main: 'main.tex',
    accent: 'linear-gradient(135deg,#94a3b8,#475569)',
    tags: ['minimal', 'article', 'starter'],
    files: [{ path: 'main.tex', content: blankMain }],
  },
  {
    id: 'article',
    name: 'Article',
    description:
      'A complete article with an abstract, equations, a TikZ figure, a booktabs table, cross-references and a biblatex bibliography.',
    category: 'academic',
    engine: 'pdflatex',
    main: 'main.tex',
    accent: 'linear-gradient(135deg,#0ea5e9,#6366f1)',
    tags: ['article', 'paper', 'biblatex', 'tikz'],
    files: [
      { path: 'main.tex', content: articleMain },
      { path: 'references.bib', content: articleBib },
    ],
  },
  {
    id: 'report',
    name: 'Technical report',
    description:
      'A report with a title page, chapters, styled headings, running headers and a natbib bibliography processed by BibTeX.',
    category: 'basic',
    engine: 'pdflatex',
    main: 'main.tex',
    accent: 'linear-gradient(135deg,#2dd4bf,#0f766e)',
    tags: ['report', 'chapters', 'natbib', 'bibtex'],
    files: [
      { path: 'main.tex', content: reportMain },
      { path: 'references.bib', content: reportBib },
    ],
  },
  {
    id: 'thesis',
    name: 'Thesis',
    description:
      'A multi-file thesis with front matter, one file per chapter, an appendix and a BibTeX bibliography.',
    category: 'book',
    engine: 'pdflatex',
    main: 'main.tex',
    accent: 'linear-gradient(135deg,#1e3a8a,#7c3aed)',
    tags: ['thesis', 'dissertation', 'multi-file', 'bibtex'],
    files: [
      { path: 'main.tex', content: thesisMain },
      { path: 'frontmatter/titlepage.tex', content: thesisTitlepage },
      { path: 'frontmatter/abstract.tex', content: thesisAbstract },
      { path: 'frontmatter/acknowledgements.tex', content: thesisAcknowledgements },
      { path: 'chapters/introduction.tex', content: thesisIntroduction },
      { path: 'chapters/background.tex', content: thesisBackground },
      { path: 'chapters/methods.tex', content: thesisMethods },
      { path: 'chapters/results.tex', content: thesisResults },
      { path: 'chapters/conclusion.tex', content: thesisConclusion },
      { path: 'chapters/appendix.tex', content: thesisAppendix },
      { path: 'references.bib', content: thesisBib },
    ],
  },
  {
    id: 'beamer',
    name: 'Presentation',
    description:
      'A clean 16:9 Beamer deck with a progress bar, section slides, blocks, columns, TikZ diagrams and overlays.',
    category: 'presentation',
    engine: 'pdflatex',
    main: 'main.tex',
    accent: 'linear-gradient(135deg,#eb811b,#23373b)',
    tags: ['beamer', 'slides', 'talk', 'tikz'],
    files: [{ path: 'main.tex', content: beamerMain }],
  },
  {
    id: 'poster',
    name: 'Academic poster',
    description:
      'An A0 conference poster built with tikzposter, featuring coloured blocks, a pipeline diagram and a pgfplots chart.',
    category: 'poster',
    engine: 'pdflatex',
    main: 'main.tex',
    accent: 'linear-gradient(135deg,#0284c7,#f59e0b)',
    tags: ['poster', 'tikzposter', 'conference', 'a0'],
    files: [{ path: 'main.tex', content: posterMain }],
  },
  {
    id: 'cv',
    name: 'Modern CV',
    description:
      'A one-page CV with a clean header, TikZ-drawn contact icons, timeline entries and skill ratings.',
    category: 'cv',
    engine: 'pdflatex',
    main: 'main.tex',
    accent: 'linear-gradient(135deg,#2dd4bf,#065f46)',
    tags: ['cv', 'resume', 'one-page', 'tikz'],
    files: [{ path: 'main.tex', content: cvMain }],
  },
  {
    id: 'cv-xelatex',
    name: 'Résumé with sidebar (XeLaTeX)',
    description:
      'A two-column résumé with a dark sidebar and skill bars, typeset with XeLaTeX and the TeX Gyre Heros font.',
    category: 'cv',
    engine: 'xelatex',
    main: 'main.tex',
    accent: 'linear-gradient(135deg,#1e293b,#38bdf8)',
    tags: ['resume', 'cv', 'xelatex', 'fontspec'],
    files: [{ path: 'main.tex', content: cvXelatexMain }],
  },
  {
    id: 'cover-letter',
    name: 'Cover letter',
    description: 'A one-page cover letter with a letterhead that matches the Modern CV template.',
    category: 'letter',
    engine: 'pdflatex',
    main: 'main.tex',
    accent: 'linear-gradient(135deg,#fb7185,#be123c)',
    tags: ['letter', 'job', 'application'],
    files: [{ path: 'main.tex', content: coverLetterMain }],
  },
  {
    id: 'book',
    name: 'Book',
    description:
      'A trade-paperback book with front matter, parts and chapters, elegant chapter headings and back matter.',
    category: 'book',
    engine: 'pdflatex',
    main: 'main.tex',
    accent: 'linear-gradient(135deg,#d97706,#78350f)',
    tags: ['book', 'novel', 'parts', 'chapters'],
    files: [{ path: 'main.tex', content: bookMain }],
  },
  {
    id: 'homework',
    name: 'Homework',
    description:
      'A problem set with numbered problems, worked solutions, aligned equations and a code listing.',
    category: 'academic',
    engine: 'pdflatex',
    main: 'main.tex',
    accent: 'linear-gradient(135deg,#a3e635,#15803d)',
    tags: ['homework', 'problem-set', 'amsthm', 'math'],
    files: [{ path: 'main.tex', content: homeworkMain }],
  },
  {
    id: 'lab-report',
    name: 'Lab report',
    description:
      'A laboratory report with siunitx units, a decimal-aligned data table, a pgfplots graph with error bars and an uncertainty analysis.',
    category: 'academic',
    engine: 'pdflatex',
    main: 'main.tex',
    accent: 'linear-gradient(135deg,#22d3ee,#0e7490)',
    tags: ['lab', 'science', 'siunitx', 'pgfplots'],
    files: [{ path: 'main.tex', content: labReportMain }],
  },
  {
    id: 'ieee',
    name: 'IEEE conference paper',
    description:
      'A two-column paper using the official IEEEtran class with a pgfplots chart, a table and an IEEE-style BibTeX bibliography.',
    category: 'academic',
    engine: 'pdflatex',
    main: 'main.tex',
    accent: 'linear-gradient(135deg,#00629b,#002855)',
    tags: ['ieee', 'conference', 'two-column', 'bibtex'],
    files: [
      { path: 'main.tex', content: ieeeMain },
      { path: 'references.bib', content: ieeeBib },
    ],
    // IEEEtran is not part of the in-browser TeX Live tiers: ship the class and style with the project (LPPL 1.3).
    assets: [
      { path: 'IEEEtran.cls', url: 'templates/ieee/IEEEtran.cls' },
      { path: 'IEEEtran.bst', url: 'templates/ieee/IEEEtran.bst' },
    ],
  },
  {
    id: 'math-notes',
    name: 'Math lecture notes',
    description:
      'Lecture notes with colour-coded tcolorbox definitions, theorems and examples, proofs and a TikZ illustration.',
    category: 'academic',
    engine: 'pdflatex',
    main: 'main.tex',
    accent: 'linear-gradient(135deg,#a855f7,#ec4899)',
    tags: ['math', 'lecture-notes', 'tcolorbox', 'theorems'],
    files: [{ path: 'main.tex', content: mathNotesMain }],
  },
  {
    id: 'articulo-es',
    name: 'Artículo en español',
    description:
      'Un artículo en español con babel, resumen, ecuaciones, tabla, figura en TikZ y referencias.',
    category: 'academic',
    engine: 'pdflatex',
    main: 'main.tex',
    accent: 'linear-gradient(135deg,#dc2626,#facc15)',
    tags: ['español', 'artículo', 'spanish', 'babel'],
    files: [{ path: 'main.tex', content: articuloEsMain }],
  },
];

/** Gallery sections, in display order. Covers every template category. */
export const templateCategories: { id: ProjectTemplate['category']; label: string }[] = [
  { id: 'basic', label: 'Basic' },
  { id: 'academic', label: 'Academic' },
  { id: 'presentation', label: 'Presentations' },
  { id: 'poster', label: 'Posters' },
  { id: 'cv', label: 'CV & Résumé' },
  { id: 'letter', label: 'Letters' },
  { id: 'book', label: 'Books & Theses' },
  { id: 'other', label: 'Other' },
];

export function getTemplate(id: string): ProjectTemplate | undefined {
  return templates.find((t) => t.id === id);
}
