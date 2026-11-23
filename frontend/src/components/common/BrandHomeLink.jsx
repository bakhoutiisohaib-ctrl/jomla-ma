import { Link } from '../../navigation';

export default function BrandHomeLink({ children, ...props }) {
  return <Link {...props} to="/" style={{ color: 'inherit', textDecoration: 'none' }}>{children}</Link>;
}
