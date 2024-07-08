import Link from 'next/link'
import { FaGithub, FaEnvelope, FaRss, FaTelegramPlane } from 'react-icons/fa'


const YEAR = new Date().getFullYear();

export default {
  footer: (
    <div>
      <hr />
      <div className="grid auto-cols-min grid-flow-col gap-8 text-xl ss:gap-4">

        <Link
          href="mailto:haigeek@qq.com"
          target="_blank"
          rel="me"
          className=""
        >
          <FaEnvelope />
        </Link>
        <Link
          href="https://github.com/haigeek"
          target="_blank"
          rel="noreferrer"
          aria-label="Github"
          className=""
        >
          <FaGithub />
        </Link>
        <Link
          href="https://t.me/haigeek"
          target="_blank"
          rel="noreferrer"
          aria-label="Telegram"
          className=""
        >
          <FaTelegramPlane />
        </Link>
        <Link href="/feed.xml" target="_blank" rel="noreferrer" aria-label="RSS" className="">
          <FaRss />
        </Link>
      </div>
      <small className="mt-32 block text-p-light dark:text-inherit">
        <abbr
          title="This site and all its content are licensed under a Creative Commons Attribution-NonCommercial 4.0 International License."
          className="cursor-help"
        >
          CC BY-NC 4.0
        </abbr>{' '}
        <time>{YEAR}</time> © haigeek.
        {/* <div className="float-right">[ Afezria ]</div> */}
      </small>
    </div>
  ),
  // footer: (
  //   <footer>
  //     <small>
  //       <time>{YEAR}</time> © Your Name.
  //       <a href="/feed.xml">RSS</a>
  //     </small>
  //     <style jsx>{`
  //       footer {
  //         margin-top: 8rem;
  //       }
  //       a {
  //         float: right;
  //       }
  //     `}</style>
  //   </footer>
  // ),
};
